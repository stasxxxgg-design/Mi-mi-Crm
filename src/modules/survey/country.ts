/**
 * Спец-логика country-вопроса: вся UX-механика страны (кнопки top-стран,
 * текстовый fallback, fuzzy-подтверждение, самообучение) — здесь.
 * Зависимости: timezones (resolver + fuzzy), survey (repository + engine).
 *
 * Сценарий из PRD §5.5:
 *   1) Бот шлёт inline-клавиатуру: 🇺🇦 / 🇧🇾 / 🇵🇱 / 🇷🇺 + кнопка "Другое".
 *   2) Лид нажимает страну → сохраняем сразу, идём к следующему вопросу.
 *   3) Лид нажимает "Другое" → бот: "Напиши страну текстом".
 *   4) Лид пишет текст → fuzzy:
 *      • exact          → сохраняем, advance;
 *      • levenshtein/trigram → "Ты имела в виду X?" Да/Нет;
 *      • ничего         → "Не нашли. Напиши ещё раз" (счётчик failedAttempts);
 *      • после 3 фейлов → сохраняем raw как country, ставим countryNeedsReview=true,
 *                          timezone=дефолт (Europe/Kyiv) и идём дальше.
 *   5) "Да" на подсказку → сохраняем выбранную страну + learnAlias(введённый текст).
 *   6) "Нет" на подсказку → "Напиши ещё раз" (без инкремента — это намеренный
 *      отказ юзера, не невалидный ввод).
 *
 * Состояние flow хранится в LeadProfile.surveyAnswers под ключом _countryFlow:
 *   { state: 'awaiting_text' | 'awaiting_confirm', pendingCountryId?, pendingAlias? }
 * Префикс `_` — служебный, эти ключи не показываем в админке.
 */
import type { Country, LeadProfile, PrismaClient, SurveyQuestion } from '@prisma/client';
import { findCountryByIso } from '../timezones/resolver.js';
import { fuzzyFindCountry, learnAlias } from '../timezones/fuzzy.js';
import { getQuestionById, mergeSurveyAnswers, removeSurveyAnswerKey } from './repository.js';
import { advanceFromQuestion, MAX_ATTEMPTS, type EngineResult } from './engine.js';

const COUNTRY_FLOW_KEY = '_countryFlow';

type CountryFlowState = {
  state: 'awaiting_text' | 'awaiting_confirm';
  pendingCountryId?: string;
  pendingAlias?: string;
};

export type CountryFlowResult =
  | { kind: 'saved'; country: Country; engineResult: EngineResult }
  | { kind: 'ask_text' }
  | { kind: 'suggest'; country: Country; alias: string }
  | { kind: 'ask_again'; attemptsLeft: number }
  | { kind: 'flagged_for_review'; engineResult: EngineResult }
  | { kind: 'unexpected'; reason: string };

/** Состояние: лид нажал "Другое" и сейчас должен ввести страну текстом. */
export function isAwaitingCountryText(profile: LeadProfile): boolean {
  const flow = readFlow(profile);
  return flow?.state === 'awaiting_text';
}

/** Состояние: бот предложил подсказку, ждём кнопку Да/Нет. */
export function isAwaitingCountryConfirm(profile: LeadProfile): boolean {
  const flow = readFlow(profile);
  return flow?.state === 'awaiting_confirm';
}

/** Лид нажал на кнопку конкретной страны из топ-списка. */
export async function handleCountryPick(
  prisma: PrismaClient,
  leadProfileId: string,
  isoCode: string,
): Promise<CountryFlowResult> {
  const country = await findCountryByIso(prisma, isoCode);
  if (!country) return { kind: 'unexpected', reason: 'unknown_iso' };
  return saveCountryAndAdvance(prisma, leadProfileId, country);
}

/** Лид нажал "Другое" — переключаемся в режим текстового ввода. */
export async function handleCountryOther(
  prisma: PrismaClient,
  leadProfileId: string,
): Promise<CountryFlowResult> {
  await mergeSurveyAnswers(prisma, leadProfileId, {
    [COUNTRY_FLOW_KEY]: { state: 'awaiting_text' },
  });
  return { kind: 'ask_text' };
}

/** Лид ввёл текстом название страны (после "Другое" или после "Нет"). */
export async function handleCountryText(
  prisma: PrismaClient,
  leadProfileId: string,
  raw: string,
): Promise<CountryFlowResult> {
  const profile = await prisma.leadProfile.findUnique({ where: { id: leadProfileId } });
  if (!profile?.currentSurveyQuestionId) {
    return { kind: 'unexpected', reason: 'no_active_question' };
  }
  const question = await getQuestionById(prisma, profile.currentSurveyQuestionId);
  if (!question?.isCountryQuestion) {
    return { kind: 'unexpected', reason: 'not_a_country_question' };
  }

  const match = await fuzzyFindCountry(prisma, raw);

  if (match && match.matchedOn === 'exact') {
    return saveCountryAndAdvance(prisma, leadProfileId, match.country);
  }

  if (match) {
    // levenshtein или trigram — нужно подтверждение
    await mergeSurveyAnswers(prisma, leadProfileId, {
      [COUNTRY_FLOW_KEY]: {
        state: 'awaiting_confirm',
        pendingCountryId: match.country.id,
        pendingAlias: raw.trim().toLowerCase(),
      },
    });
    return { kind: 'suggest', country: match.country, alias: raw.trim() };
  }

  // ничего не нашли — увеличиваем счётчик
  const attempts = profile.failedAttempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return flagAndAdvance(prisma, leadProfileId, question, raw);
  }
  await prisma.leadProfile.update({
    where: { id: leadProfileId },
    data: { failedAttempts: attempts },
  });
  return { kind: 'ask_again', attemptsLeft: MAX_ATTEMPTS - attempts };
}

/** Лид нажал "Да" на подсказанную страну. */
export async function handleCountryConfirm(
  prisma: PrismaClient,
  leadProfileId: string,
): Promise<CountryFlowResult> {
  const profile = await prisma.leadProfile.findUnique({ where: { id: leadProfileId } });
  if (!profile) return { kind: 'unexpected', reason: 'profile_not_found' };

  const flow = readFlow(profile);
  if (flow?.state !== 'awaiting_confirm' || !flow.pendingCountryId) {
    return { kind: 'unexpected', reason: 'no_pending_country' };
  }
  const country = await prisma.country.findUnique({ where: { id: flow.pendingCountryId } });
  if (!country) return { kind: 'unexpected', reason: 'pending_country_gone' };

  if (flow.pendingAlias) {
    await learnAlias(prisma, country.id, flow.pendingAlias);
  }
  return saveCountryAndAdvance(prisma, leadProfileId, country);
}

/** Лид нажал "Нет" — возвращаемся в режим текстового ввода без штрафа. */
export async function handleCountryReject(
  prisma: PrismaClient,
  leadProfileId: string,
): Promise<CountryFlowResult> {
  await mergeSurveyAnswers(prisma, leadProfileId, {
    [COUNTRY_FLOW_KEY]: { state: 'awaiting_text' },
  });
  return { kind: 'ask_again', attemptsLeft: -1 };
}

// ---------- internals ----------

function readFlow(profile: LeadProfile): CountryFlowState | null {
  const answers = profile.surveyAnswers as Record<string, unknown> | null;
  if (!answers) return null;
  const raw = answers[COUNTRY_FLOW_KEY];
  if (!raw || typeof raw !== 'object') return null;
  return raw as CountryFlowState;
}

async function saveCountryAndAdvance(
  prisma: PrismaClient,
  leadProfileId: string,
  country: Country,
): Promise<CountryFlowResult> {
  const profile = await prisma.leadProfile.findUnique({ where: { id: leadProfileId } });
  if (!profile?.currentSurveyQuestionId) {
    return { kind: 'unexpected', reason: 'no_active_question' };
  }
  const question = await getQuestionById(prisma, profile.currentSurveyQuestionId);
  if (!question?.isCountryQuestion) {
    return { kind: 'unexpected', reason: 'not_a_country_question' };
  }

  await mergeSurveyAnswers(prisma, leadProfileId, { [question.key]: country.name });
  await removeSurveyAnswerKey(prisma, leadProfileId, COUNTRY_FLOW_KEY);
  await prisma.leadProfile.update({
    where: { id: leadProfileId },
    data: {
      country: country.name,
      timezone: country.timezone,
      countryNeedsReview: false,
      failedAttempts: 0,
    },
  });

  const engineResult = await advanceFromQuestion(prisma, leadProfileId, question.order);
  return { kind: 'saved', country, engineResult };
}

async function flagAndAdvance(
  prisma: PrismaClient,
  leadProfileId: string,
  question: SurveyQuestion,
  rawInput: string,
): Promise<CountryFlowResult> {
  // Не распознали страну, сохраняем как есть и поднимаем флаг для админа.
  // Timezone оставляем дефолтом — админ исправит и при правке заодно
  // подгонит timezone.
  const trimmed = rawInput.trim();
  await mergeSurveyAnswers(prisma, leadProfileId, {
    [question.key]: trimmed || null,
  });
  await removeSurveyAnswerKey(prisma, leadProfileId, COUNTRY_FLOW_KEY);
  await prisma.leadProfile.update({
    where: { id: leadProfileId },
    data: {
      country: trimmed || null,
      countryNeedsReview: true,
      failedAttempts: 0,
    },
  });
  const engineResult = await advanceFromQuestion(prisma, leadProfileId, question.order);
  return { kind: 'flagged_for_review', engineResult };
}
