/**
 * Хэндлеры анкеты для лида: рендер вопроса + диспатч callback/text-ответов.
 * Зависимости: grammy, prisma, survey engine, country flow, timezones.
 *
 * Диспатчер один — единая точка для всех `callback_query:data` с префиксом
 * `survey:` и `message:text` от лидов в активной анкете. Отдельные
 * bot.callbackQuery(...) на каждую кнопку избыточны и плохо переживают
 * рефакторинг callback-форматов, поэтому фильтруем сами по data.
 *
 * Формат callback_data (≤64 байт):
 *   survey:choice:<questionKey>:<value>        — обычный CHOICE
 *   survey:country:pick:<isoCode>              — кнопка топ-страны
 *   survey:country:other                       — "Другое" → текстовый ввод
 *   survey:country:confirm                     — "Да" на fuzzy-подсказку
 *   survey:country:reject                      — "Нет" на fuzzy-подсказку
 *
 * Pending данные (какую страну предлагаем) лежат в LeadProfile.surveyAnswers
 * под ключом `_countryFlow`, не в callback_data — длинные UTF-8 алиасы не
 * влезают в 64-байтный лимит.
 */
import { InlineKeyboard, type Bot } from 'grammy';
import type { SurveyQuestion } from '@prisma/client';
import { prisma } from '../../../core/db.js';
import { logger } from '../../../core/logger.js';
import {
  MAX_ATTEMPTS,
  submitAnswer,
  type EngineResult,
} from '../../../modules/survey/engine.js';
import {
  handleCountryConfirm,
  handleCountryOther,
  handleCountryPick,
  handleCountryReject,
  handleCountryText,
  isAwaitingCountryConfirm,
  isAwaitingCountryText,
  type CountryFlowResult,
} from '../../../modules/survey/country.js';
import { listTopCountries } from '../../../modules/timezones/resolver.js';
import type { BotContext } from '../../types.js';

type ChoiceOption = { label: string; value: string };

const CALLBACK_PREFIX = 'survey:';

// ============ Render ============

export async function sendQuestion(ctx: BotContext, question: SurveyQuestion): Promise<void> {
  const text = question.hint ? `${question.question}\n\n<i>${question.hint}</i>` : question.question;

  if (question.isCountryQuestion) {
    const keyboard = await buildTopCountriesKeyboard();
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    return;
  }

  if (question.type === 'CHOICE') {
    const keyboard = buildChoiceKeyboard(question);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    return;
  }

  // NUMBER / TEXT — без клавиатуры, ждём свободный текст
  await ctx.reply(text, { parse_mode: 'HTML' });
}

async function buildTopCountriesKeyboard(): Promise<InlineKeyboard> {
  const countries = await listTopCountries(prisma);
  const kb = new InlineKeyboard();
  for (const c of countries) {
    const label = `${c.flagEmoji ?? ''} ${c.name}`.trim();
    kb.text(label, `${CALLBACK_PREFIX}country:pick:${c.isoCode}`).row();
  }
  kb.text('Другое…', `${CALLBACK_PREFIX}country:other`);
  return kb;
}

function buildChoiceKeyboard(question: SurveyQuestion): InlineKeyboard {
  const options = (question.options as ChoiceOption[] | null) ?? [];
  const kb = new InlineKeyboard();
  for (const opt of options) {
    kb.text(opt.label, `${CALLBACK_PREFIX}choice:${question.key}:${opt.value}`).row();
  }
  return kb;
}

// ============ Registration ============

export function registerSurveyHandlers(bot: Bot<BotContext>): void {
  bot.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(CALLBACK_PREFIX)) {
      await next();
      return;
    }

    // Telegram требует ack на callback в течение нескольких секунд — отвечаем рано.
    await ctx.answerCallbackQuery();

    if (!ctx.user || !ctx.leadProfile) {
      logger.warn({ data }, 'survey callback without user/leadProfile');
      return;
    }

    const parts = data.split(':'); // ['survey', namespace, action, ...args]
    const namespace = parts[1];
    const action = parts[2];

    if (namespace === 'choice') {
      // Формат: survey:choice:<questionKey>:<value> → parts[3] = value.
      const value = parts[3] ?? '';
      const result = await submitAnswer(prisma, ctx.leadProfile.id, value);
      await reportEngineResult(ctx, result);
      return;
    }

    if (namespace === 'country') {
      if (action === 'pick') {
        const iso = parts[3] ?? '';
        const result = await handleCountryPick(prisma, ctx.leadProfile.id, iso);
        await reportCountryResult(ctx, result);
        return;
      }
      if (action === 'other') {
        await handleCountryOther(prisma, ctx.leadProfile.id);
        await ctx.reply('Напиши страну текстом — постараюсь распознать.');
        return;
      }
      if (action === 'confirm') {
        const result = await handleCountryConfirm(prisma, ctx.leadProfile.id);
        await reportCountryResult(ctx, result);
        return;
      }
      if (action === 'reject') {
        await handleCountryReject(prisma, ctx.leadProfile.id);
        await ctx.reply('Окей, напиши страну ещё раз — постараюсь распознать точнее.');
        return;
      }
    }

    logger.warn({ data }, 'unknown survey callback');
  });

  bot.on('message:text', async (ctx, next) => {
    // Только лиды в активной анкете. Админы и юзеры вне анкеты — пропускаем дальше.
    if (!ctx.user || !ctx.leadProfile || ctx.user.role !== 'LEAD') {
      await next();
      return;
    }
    if (!ctx.leadProfile.currentSurveyQuestionId) {
      await next();
      return;
    }

    const raw = ctx.message.text;

    if (isAwaitingCountryText(ctx.leadProfile)) {
      const result = await handleCountryText(prisma, ctx.leadProfile.id, raw);
      await reportCountryResult(ctx, result);
      return;
    }

    if (isAwaitingCountryConfirm(ctx.leadProfile)) {
      // Лид написал текст, когда мы ждём кнопку Да/Нет. Просим нажать.
      await ctx.reply('Нажми <b>Да</b> или <b>Нет</b> под предложенной страной.', {
        parse_mode: 'HTML',
      });
      return;
    }

    const result = await submitAnswer(prisma, ctx.leadProfile.id, raw);
    await reportEngineResult(ctx, result);
  });
}

// ============ Result → UX ============

async function reportEngineResult(ctx: BotContext, result: EngineResult): Promise<void> {
  switch (result.kind) {
    case 'asked':
      await sendQuestion(ctx, result.question);
      return;
    case 'invalid': {
      const left = MAX_ATTEMPTS - result.attempts;
      await ctx.reply(`${result.error}\n\nОсталось попыток: ${left}.`);
      return;
    }
    case 'skipped_after_max':
      await ctx.reply('Пропустим этот вопрос — идём дальше.');
      if (result.nextQuestion) {
        await sendQuestion(ctx, result.nextQuestion);
      } else {
        await sendCompletionMessage(ctx);
      }
      return;
    case 'completed':
      await sendCompletionMessage(ctx);
      return;
    case 'unexpected':
      // Текст на country-вопросе до нажатия "Другое" — engine.submitAnswer
      // не валидирует isCountryQuestion, возвращает unexpected. Сообщаем лиду
      // как правильно отвечать, чтобы не оставлять silent-fail.
      if (result.reason === 'country_should_be_dispatched_to_country_flow') {
        await ctx.reply(
          'Выбери страну кнопкой или нажми <b>Другое…</b>, чтобы написать её текстом.',
          { parse_mode: 'HTML' },
        );
      }
      logger.warn({ reason: result.reason }, 'Unexpected engine result');
      return;
  }
}

async function reportCountryResult(ctx: BotContext, result: CountryFlowResult): Promise<void> {
  switch (result.kind) {
    case 'saved': {
      const c = result.country;
      await ctx.reply(`Записал: ${c.flagEmoji ?? ''} ${c.name}`.trim());
      if (result.engineResult.kind === 'asked') {
        await sendQuestion(ctx, result.engineResult.question);
      } else if (result.engineResult.kind === 'completed') {
        await sendCompletionMessage(ctx);
      }
      return;
    }
    case 'suggest': {
      const kb = new InlineKeyboard()
        .text('Да', `${CALLBACK_PREFIX}country:confirm`)
        .text('Нет, другое', `${CALLBACK_PREFIX}country:reject`);
      await ctx.reply(
        `Ты имела в виду <b>${result.country.flagEmoji ?? ''} ${result.country.name}</b>?`,
        { parse_mode: 'HTML', reply_markup: kb },
      );
      return;
    }
    case 'ask_text':
      // ack-only; bot reply печатается в caller'е (handleCountryOther path).
      return;
    case 'ask_again': {
      if (result.attemptsLeft > 0) {
        await ctx.reply(`Не нашли такую страну. Попробуй ещё раз — осталось попыток: ${result.attemptsLeft}.`);
      } else {
        await ctx.reply('Окей, напиши ещё раз.');
      }
      return;
    }
    case 'flagged_for_review':
      await ctx.reply('Не смогли распознать страну — передам админу, разберётся.');
      if (result.engineResult.kind === 'asked') {
        await sendQuestion(ctx, result.engineResult.question);
      } else if (result.engineResult.kind === 'completed') {
        await sendCompletionMessage(ctx);
      }
      return;
    case 'unexpected':
      logger.warn({ reason: result.reason }, 'Unexpected country result');
      return;
  }
}

async function sendCompletionMessage(ctx: BotContext): Promise<void> {
  await ctx.reply(
    'Спасибо! Анкета пройдена. В ближайшее время менеджер пришлёт ссылку на интро-кал.',
  );
}
