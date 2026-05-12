/**
 * Стейт-машина анкеты для обычных вопросов (NUMBER / CHOICE / TEXT).
 * Зависимости: @prisma/client, repository, validator.
 *
 * Country-вопросы сюда НЕ попадают — диспатчер в handlers смотрит на
 * `question.isCountryQuestion` и направляет такой запрос в country.ts.
 * Здесь мы только продвигаем стейт после того, как country.ts закончит
 * свою работу — через экспорт `advanceFromQuestion`/`completeSurvey`.
 *
 * Состояние лида в анкете хранится в LeadProfile:
 *   - currentSurveyQuestionId — на каком вопросе остановились (null = вне анкеты)
 *   - failedAttempts          — сколько раз подряд ввели невалидное (на этом вопросе)
 *   - surveyAnswers           — JSON { key: value }; null для скипнутых
 *   - phase=TASK_COMPLETED    — выставляется когда вопросов больше нет
 *
 * Денормализация (PRD §5.1): age пишем в отдельную колонку для быстрых
 * фильтров. country/timezone денормализует country.ts (для него специфично).
 */
import type { Prisma, PrismaClient, SurveyQuestion } from '@prisma/client';
import { logger } from '../../core/logger.js';
import {
  getFirstActiveQuestion,
  getNextActiveQuestion,
  getQuestionById,
  mergeSurveyAnswers,
} from './repository.js';
import { validateAnswer } from './validator.js';

const MAX_SKIPS_IN_ADVANCE = 10;

export const MAX_ATTEMPTS = 3;

export type EngineResult =
  | { kind: 'asked'; question: SurveyQuestion }
  | { kind: 'invalid'; error: string; attempts: number }
  | { kind: 'skipped_after_max'; nextQuestion: SurveyQuestion | null }
  | { kind: 'completed' }
  | { kind: 'unexpected'; reason: string };

/** Стартует анкету для лида: ставит первый активный вопрос. */
export async function startSurvey(
  prisma: PrismaClient,
  leadProfileId: string,
): Promise<EngineResult> {
  const first = await getFirstActiveQuestion(prisma);
  if (!first) {
    await completeSurvey(prisma, leadProfileId);
    return { kind: 'completed' };
  }
  await prisma.leadProfile.update({
    where: { id: leadProfileId },
    data: { currentSurveyQuestionId: first.id, failedAttempts: 0 },
  });
  return { kind: 'asked', question: first };
}

/**
 * Обрабатывает ответ на обычный (не country) вопрос. На вход — строка
 * (для NUMBER/TEXT — текст сообщения, для CHOICE — value из callback_data).
 */
export async function submitAnswer(
  prisma: PrismaClient,
  leadProfileId: string,
  raw: string,
): Promise<EngineResult> {
  const profile = await prisma.leadProfile.findUnique({ where: { id: leadProfileId } });
  if (!profile || !profile.currentSurveyQuestionId) {
    return { kind: 'unexpected', reason: 'no_active_question' };
  }
  const question = await getQuestionById(prisma, profile.currentSurveyQuestionId);
  if (!question) {
    return { kind: 'unexpected', reason: 'question_not_found' };
  }
  if (question.isCountryQuestion) {
    return { kind: 'unexpected', reason: 'country_should_be_dispatched_to_country_flow' };
  }

  const result = validateAnswer(question, raw);

  if (result.kind === 'needs_country_flow') {
    // Defensive: на этом этапе уже отрезано isCountryQuestion-check'ом, но
    // мы не верим в недостижимые ветки на типах enum.
    return { kind: 'unexpected', reason: 'country_should_be_dispatched_to_country_flow' };
  }

  if (result.kind === 'unsupported_type') {
    // Кривая конфигурация — не мучаем лида, скипаем вопрос.
    await mergeSurveyAnswers(prisma, leadProfileId, { [question.key]: null });
    return advanceFromQuestion(prisma, leadProfileId, question.order);
  }

  if (result.kind === 'invalid') {
    const attempts = profile.failedAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await mergeSurveyAnswers(prisma, leadProfileId, { [question.key]: null });
      const advanced = await advanceFromQuestion(prisma, leadProfileId, question.order);
      const nextQuestion = advanced.kind === 'asked' ? advanced.question : null;
      return { kind: 'skipped_after_max', nextQuestion };
    }
    await prisma.leadProfile.update({
      where: { id: leadProfileId },
      data: { failedAttempts: attempts },
    });
    return { kind: 'invalid', error: result.error, attempts };
  }

  // ok — сохраняем + денормализуем + двигаемся
  await mergeSurveyAnswers(prisma, leadProfileId, {
    [question.key]: result.value as Prisma.JsonValue,
  });
  await denormalize(prisma, leadProfileId, question.key, result.value);
  return advanceFromQuestion(prisma, leadProfileId, question.order);
}

/**
 * Передвинуть лида с текущего вопроса (по order) на следующий активный.
 * Если следующего нет — завершить анкету. Экспортируется для country.ts.
 *
 * Внутри — цикл с защитой: если в анкете подряд встретились unsupported_type
 * вопросы (MULTI_CHOICE / BOOLEAN — заглушки на MVP), скипаем их без участия
 * юзера. Лимит skippedInARow > 10 предохраняет от бесконечной петли на
 * случай, если админ накосячит и вся анкета окажется unsupported.
 */
export async function advanceFromQuestion(
  prisma: PrismaClient,
  leadProfileId: string,
  currentOrder: number,
): Promise<EngineResult> {
  let order = currentOrder;
  let skippedInARow = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = await getNextActiveQuestion(prisma, order);
    if (!next) {
      await completeSurvey(prisma, leadProfileId);
      return { kind: 'completed' };
    }

    // Unsupported тип — скипаем здесь же, не показывая юзеру.
    if (next.type === 'MULTI_CHOICE' || next.type === 'BOOLEAN') {
      await mergeSurveyAnswers(prisma, leadProfileId, { [next.key]: null });
      order = next.order;
      skippedInARow += 1;
      if (skippedInARow > MAX_SKIPS_IN_ADVANCE) {
        logger.warn(
          { leadProfileId, skippedInARow },
          'Too many skipped questions in survey, force-completing',
        );
        await completeSurvey(prisma, leadProfileId);
        return { kind: 'completed' };
      }
      continue;
    }

    await prisma.leadProfile.update({
      where: { id: leadProfileId },
      data: { currentSurveyQuestionId: next.id, failedAttempts: 0 },
    });
    return { kind: 'asked', question: next };
  }
}

/**
 * Помечает анкету как пройденную. Экспорт для country.ts.
 *
 * Перед сохранением чистим служебные ключи (начинающиеся с `_`, например
 * `_countryFlow`) — они нужны только во время прохождения анкеты, в конечном
 * surveyAnswers их быть не должно.
 */
export async function completeSurvey(prisma: PrismaClient, leadProfileId: string): Promise<void> {
  const profile = await prisma.leadProfile.findUnique({
    where: { id: leadProfileId },
    select: { surveyAnswers: true },
  });
  const current = (profile?.surveyAnswers as Record<string, Prisma.JsonValue> | null) ?? {};
  const cleaned = Object.fromEntries(Object.entries(current).filter(([k]) => !k.startsWith('_')));

  await prisma.leadProfile.update({
    where: { id: leadProfileId },
    data: {
      currentSurveyQuestionId: null,
      failedAttempts: 0,
      phase: 'TASK_COMPLETED',
      surveyAnswers: cleaned as Prisma.InputJsonValue,
    },
  });
}

/**
 * Денормализация ответа в колонки LeadProfile.
 * Захардкожено для известных ключей. Когда подключим динамические анкеты
 * (день 4 CMS), вынесем маппинг в SurveyQuestion-поле `denormalizeTo`.
 */
async function denormalize(
  prisma: PrismaClient,
  leadProfileId: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (key === 'age' && typeof value === 'number') {
    await prisma.leadProfile.update({
      where: { id: leadProfileId },
      data: { age: value },
    });
  }
  // country/timezone денормализуются в country.ts — у них своя логика
  // (fuzzy, learnAlias, countryNeedsReview).
}
