/**
 * Wizard /survey_add — создание SurveyQuestion (PRD §5.4 + Day 4A).
 * Зависимости: grammy, @grammyjs/conversations, prisma, _wizard-common.
 *
 * 10 шагов с валидациями, общие ask*-функции живут в _wizard-common.ts.
 * Здесь — только сценарий: какой шаг идёт после какого + специфичный preview.
 */
import { InlineKeyboard, type Composer } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { prisma } from '../../../core/db.js';
import type { BotContext } from '../../types.js';
import {
  CancelError,
  askHint,
  askIsCountryQuestion,
  askIsRequired,
  askKey,
  askNumberValidation,
  askOptions,
  askOrder,
  askQuestion,
  askTextValidation,
  askType,
  escapeHtml,
  type ChoiceOption,
  type SupportedType,
  type WizardConversation,
} from './_wizard-common.js';

export const ADD_SURVEY_CONVERSATION_ID = 'addSurvey';

type Draft = {
  key: string;
  question: string;
  hint: string | null;
  type: SupportedType;
  options: ChoiceOption[] | null;
  validation: Record<string, number> | null;
  isRequired: boolean;
  order: number;
  isCountryQuestion: boolean;
};

async function wizard(conversation: WizardConversation, ctx: BotContext): Promise<void> {
  await ctx.reply(
    '🆕 <b>Новый вопрос анкеты</b>\n\nЯ задам несколько вопросов. В любой момент /cancel.',
    { parse_mode: 'HTML' },
  );

  try {
    const key = await askKey(conversation, ctx);
    const question = await askQuestion(conversation, ctx);
    const hint = await askHint(conversation, ctx);
    const type = await askType(conversation, ctx);

    let options: ChoiceOption[] | null = null;
    let validation: Record<string, number> | null = null;
    if (type === 'CHOICE') {
      options = await askOptions(conversation, ctx);
    } else if (type === 'NUMBER') {
      validation = await askNumberValidation(conversation, ctx);
    } else if (type === 'TEXT') {
      validation = await askTextValidation(conversation, ctx);
    }

    const isRequired = await askIsRequired(conversation, ctx);

    const defaultOrder = await conversation.external(async () => {
      const max = await prisma.surveyQuestion.aggregate({
        where: { scenarioId: null },
        _max: { order: true },
      });
      return (max._max.order ?? 0) + 1;
    });
    const order = await askOrder(conversation, ctx, defaultOrder);

    const existingCountry = await conversation.external(() =>
      prisma.surveyQuestion.findFirst({
        where: { scenarioId: null, isCountryQuestion: true, isActive: true },
      }),
    );
    let isCountryQuestion = false;
    if (existingCountry) {
      await ctx.reply(
        `<i>country-вопрос уже есть (<code>${escapeHtml(existingCountry.key)}</code>) — этот шаг скипаю.</i>`,
        { parse_mode: 'HTML' },
      );
    } else {
      isCountryQuestion = await askIsCountryQuestion(conversation, ctx);
    }

    const draft: Draft = {
      key, question, hint, type, options, validation, isRequired, order, isCountryQuestion,
    };

    const confirmed = await showPreview(conversation, ctx, draft);
    if (!confirmed) {
      await ctx.reply('Создание отменено.');
      return;
    }

    await conversation.external(() =>
      prisma.surveyQuestion.create({
        data: {
          scenarioId: null,
          key: draft.key,
          question: draft.question,
          hint: draft.hint,
          type: draft.type,
          options: draft.options ?? undefined,
          validation: draft.validation ?? undefined,
          isRequired: draft.isRequired,
          order: draft.order,
          isCountryQuestion: draft.isCountryQuestion,
          isActive: true,
        },
      }),
    );

    await ctx.reply(
      `✅ Вопрос <code>${escapeHtml(draft.key)}</code> создан. Посмотри: /survey`,
      { parse_mode: 'HTML' },
    );
  } catch (err) {
    if (err instanceof CancelError) {
      await ctx.reply('Создание отменено.');
      return;
    }
    throw err;
  }
}

async function showPreview(
  conv: WizardConversation,
  ctx: BotContext,
  draft: Draft,
): Promise<boolean> {
  const lines: string[] = [];
  lines.push('<b>Проверь и подтверди</b>');
  lines.push('');
  lines.push(
    `<code>${escapeHtml(draft.key)}</code> · ${draft.type} · ${
      draft.isRequired ? 'обязательный' : 'необязательный'
    } · order=${draft.order}`,
  );
  lines.push(escapeHtml(draft.question));
  if (draft.hint) lines.push(`<i>${escapeHtml(draft.hint)}</i>`);
  if (draft.isCountryQuestion) lines.push('<i>country-вопрос 🌍</i>');
  if (draft.options) {
    lines.push('<i>Варианты:</i>');
    for (const o of draft.options) {
      lines.push(`• ${escapeHtml(o.label)} → <code>${escapeHtml(o.value)}</code>`);
    }
  }
  if (draft.validation && Object.keys(draft.validation).length > 0) {
    lines.push(`<i>validation: ${escapeHtml(JSON.stringify(draft.validation))}</i>`);
  }

  const kb = new InlineKeyboard()
    .text('✅ Создать', 'wiz:save:1')
    .text('❌ Отмена', 'wiz:save:0');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  while (true) {
    const next = await conv.waitForCallbackQuery(/^wiz:save:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === '1') return true;
    if (v === '0') return false;
  }
}

export function registerAddSurveyConversation(composer: Composer<BotContext>): void {
  composer.use(createConversation(wizard, ADD_SURVEY_CONVERSATION_ID));
  composer.command('survey_add', async (ctx) => {
    await ctx.conversation.enter(ADD_SURVEY_CONVERSATION_ID);
  });
}
