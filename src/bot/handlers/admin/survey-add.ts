/**
 * Wizard /survey_add — 10-шаговый интерактивный диалог создания вопроса
 * через @grammyjs/conversations 2.x (PRD §5.4 + согласование Day 4A).
 *
 * Все БД-операции и побочные эффекты, которые читают изменчивое состояние
 * (uniqueness check, max order, existing country question), завёрнуты в
 * conversation.external — этого требует replay-механика conversations 2.x.
 * ctx.reply внутри conversation работает напрямую без external.
 *
 * /cancel на любом шаге → "Создание отменено" + выход (через CancelError).
 */
import { InlineKeyboard, type Composer } from 'grammy';
import { createConversation, type Conversation } from '@grammyjs/conversations';
import { prisma } from '../../../core/db.js';
import type { BotContext } from '../../types.js';

type WizardConversation = Conversation<BotContext, BotContext>;

type SupportedType = 'NUMBER' | 'TEXT' | 'CHOICE' | 'BOOLEAN';
type ChoiceOption = { label: string; value: string };

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

class CancelError extends Error {}
function checkCancel(text: string): void {
  if (text.trim().toLowerCase() === '/cancel') throw new CancelError();
}

export const ADD_SURVEY_CONVERSATION_ID = 'addSurvey';

async function wizard(conversation: WizardConversation, ctx: BotContext): Promise<void> {
  await ctx.reply(
    '🆕 <b>Новый вопрос анкеты</b>\n\nЯ задам несколько вопросов. В любой момент можешь прервать командой /cancel.',
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
        `<i>country-вопрос уже есть (<code>${existingCountry.key}</code>) — этот шаг скипаю.</i>`,
        { parse_mode: 'HTML' },
      );
    } else {
      isCountryQuestion = await askIsCountryQuestion(conversation, ctx);
    }

    const draft: Draft = {
      key,
      question,
      hint,
      type,
      options,
      validation,
      isRequired,
      order,
      isCountryQuestion,
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

// ============ asks ============

async function askKey(conv: WizardConversation, ctx: BotContext): Promise<string> {
  await ctx.reply('<b>1/10 ключ</b>\n\nsnake_case, 3–32 символа. Не начинается с <code>_</code>.', {
    parse_mode: 'HTML',
  });
  while (true) {
    const next = await conv.waitFor('message:text');
    const text = next.message.text.trim();
    checkCancel(text);

    if (!/^[a-z][a-z0-9_]*$/.test(text) || text.length < 3 || text.length > 32) {
      await next.reply('Невалидный ключ. snake_case, 3–32 символа. Ещё раз?');
      continue;
    }
    const exists = await conv.external(() =>
      prisma.surveyQuestion.findFirst({ where: { scenarioId: null, key: text } }),
    );
    if (exists) {
      await next.reply(`Ключ <code>${escapeHtml(text)}</code> уже занят. Другой?`, {
        parse_mode: 'HTML',
      });
      continue;
    }
    return text;
  }
}

async function askQuestion(conv: WizardConversation, ctx: BotContext): Promise<string> {
  await ctx.reply('<b>2/10 текст вопроса</b>\n\nЧто увидит лид. До 500 символов.', {
    parse_mode: 'HTML',
  });
  while (true) {
    const next = await conv.waitFor('message:text');
    const text = next.message.text.trim();
    checkCancel(text);
    if (!text) {
      await next.reply('Пусто. Введи текст вопроса.');
      continue;
    }
    if (text.length > 500) {
      await next.reply('Слишком длинно. До 500 символов.');
      continue;
    }
    return text;
  }
}

async function askHint(conv: WizardConversation, ctx: BotContext): Promise<string | null> {
  await ctx.reply(
    '<b>3/10 подсказка</b>\n\nКурсивом под вопросом. До 500 символов или /skip.',
    { parse_mode: 'HTML' },
  );
  while (true) {
    const next = await conv.waitFor('message:text');
    const text = next.message.text.trim();
    checkCancel(text);
    if (text.toLowerCase() === '/skip') return null;
    if (text.length > 500) {
      await next.reply('Слишком длинно. До 500 или /skip.');
      continue;
    }
    return text;
  }
}

async function askType(conv: WizardConversation, ctx: BotContext): Promise<SupportedType> {
  const kb = new InlineKeyboard()
    .text('🔢 NUMBER', 'addq:type:NUMBER')
    .text('📝 TEXT', 'addq:type:TEXT')
    .row()
    .text('☑ CHOICE', 'addq:type:CHOICE')
    .text('🟢 BOOLEAN', 'addq:type:BOOLEAN');
  await ctx.reply('<b>4/10 тип</b>', { parse_mode: 'HTML', reply_markup: kb });
  while (true) {
    const next = await conv.waitForCallbackQuery(/^addq:type:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === 'NUMBER' || v === 'TEXT' || v === 'CHOICE' || v === 'BOOLEAN') {
      return v;
    }
  }
}

async function askOptions(conv: WizardConversation, ctx: BotContext): Promise<ChoiceOption[]> {
  await ctx.reply(
    '<b>5/10 варианты ответа</b>\n\nКаждая строка вида <code>Текст|value</code>. Минимум 2.\n\nПример:\n<code>Стримила 1+ год|1plus_year\nПробовала пару раз|few_times\nНикогда|never</code>',
    { parse_mode: 'HTML' },
  );
  while (true) {
    const next = await conv.waitFor('message:text');
    const text = next.message.text;
    checkCancel(text);
    const parsed = parseOptions(text);
    if (!parsed.ok) {
      await next.reply(parsed.error);
      continue;
    }
    return parsed.options;
  }
}

function parseOptions(
  raw: string,
): { ok: true; options: ChoiceOption[] } | { ok: false; error: string } {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'Нужно минимум 2 варианта.' };
  const options: ChoiceOption[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const idx = line.indexOf('|');
    if (idx < 1 || idx === line.length - 1) {
      return { ok: false, error: `Строка "${line}" — нужен формат <code>label|value</code>.` };
    }
    const label = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!/^[a-z][a-z0-9_]*$/.test(value)) {
      return { ok: false, error: `value "${value}" — должен быть snake_case.` };
    }
    if (seen.has(value)) {
      return { ok: false, error: `value "${value}" повторяется.` };
    }
    seen.add(value);
    options.push({ label, value });
  }
  return { ok: true, options };
}

async function askNumberValidation(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<Record<string, number>> {
  await ctx.reply(
    '<b>5/10 минимум</b>\n\nЦелое число или /skip если без нижней границы.',
    { parse_mode: 'HTML' },
  );
  const min = await waitForIntOrSkip(conv);
  await ctx.reply(
    '<b>6/10 максимум</b>\n\nЦелое число или /skip если без верхней границы.',
    { parse_mode: 'HTML' },
  );
  while (true) {
    const max = await waitForIntOrSkip(conv);
    if (min !== null && max !== null && min > max) {
      await ctx.reply(`Минимум (${min}) больше максимума (${max}). Введи макс ещё раз.`);
      continue;
    }
    const v: Record<string, number> = {};
    if (min !== null) v.min = min;
    if (max !== null) v.max = max;
    return v;
  }
}

async function askTextValidation(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<Record<string, number>> {
  await ctx.reply(
    '<b>5/10 максимальная длина</b>\n\nЦелое > 0 или /skip.',
    { parse_mode: 'HTML' },
  );
  while (true) {
    const v = await waitForIntOrSkip(conv);
    if (v === null) return {};
    if (v <= 0) {
      await ctx.reply('Должно быть больше 0.');
      continue;
    }
    return { maxLength: v };
  }
}

async function waitForIntOrSkip(conv: WizardConversation): Promise<number | null> {
  while (true) {
    const next = await conv.waitFor('message:text');
    const text = next.message.text.trim();
    checkCancel(text);
    if (text.toLowerCase() === '/skip') return null;
    if (!/^-?\d+$/.test(text)) {
      await next.reply('Введи целое число или /skip.');
      continue;
    }
    return parseInt(text, 10);
  }
}

async function askIsRequired(conv: WizardConversation, ctx: BotContext): Promise<boolean> {
  const kb = new InlineKeyboard()
    .text('Да, обязательный', 'addq:req:1')
    .text('Нет', 'addq:req:0');
  await ctx.reply('<b>7/10 обязательный?</b>', { parse_mode: 'HTML', reply_markup: kb });
  while (true) {
    const next = await conv.waitForCallbackQuery(/^addq:req:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === '1') return true;
    if (v === '0') return false;
  }
}

async function askOrder(
  conv: WizardConversation,
  ctx: BotContext,
  defaultOrder: number,
): Promise<number> {
  await ctx.reply(
    `<b>8/10 порядок</b>\n\nЦелое ≥ 1. Введи число или /skip чтобы поставить в конец (${defaultOrder}).`,
    { parse_mode: 'HTML' },
  );
  while (true) {
    const next = await conv.waitFor('message:text');
    const text = next.message.text.trim();
    checkCancel(text);
    let candidate: number;
    if (text.toLowerCase() === '/skip') {
      candidate = defaultOrder;
    } else {
      if (!/^\d+$/.test(text)) {
        await next.reply('Введи целое число ≥ 1 или /skip.');
        continue;
      }
      candidate = parseInt(text, 10);
      if (candidate < 1) {
        await next.reply('Должно быть ≥ 1.');
        continue;
      }
    }
    const taken = await conv.external(() =>
      prisma.surveyQuestion.findFirst({
        where: { scenarioId: null, order: candidate },
      }),
    );
    if (taken) {
      await next.reply(
        `Порядок ${candidate} уже занят вопросом <code>${escapeHtml(taken.key)}</code>. Введи другой.`,
        { parse_mode: 'HTML' },
      );
      continue;
    }
    return candidate;
  }
}

async function askIsCountryQuestion(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<boolean> {
  const kb = new InlineKeyboard()
    .text('Да, country', 'addq:c:1')
    .text('Нет', 'addq:c:0');
  await ctx.reply(
    '<b>9/10 country-вопрос?</b>\n\nСпец-логика с топ-странами и fuzzy-матчингом. Только если этот вопрос про страну лида.',
    { parse_mode: 'HTML', reply_markup: kb },
  );
  while (true) {
    const next = await conv.waitForCallbackQuery(/^addq:c:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === '1') return true;
    if (v === '0') return false;
  }
}

async function showPreview(
  conv: WizardConversation,
  ctx: BotContext,
  draft: Draft,
): Promise<boolean> {
  const lines: string[] = [];
  lines.push('<b>10/10 проверь и подтверди</b>');
  lines.push('');
  lines.push(`<code>${escapeHtml(draft.key)}</code> · ${draft.type} · ${draft.isRequired ? 'обязательный' : 'необязательный'} · order=${draft.order}`);
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
    .text('✅ Создать', 'addq:save:1')
    .text('❌ Отмена', 'addq:save:0');
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
  while (true) {
    const next = await conv.waitForCallbackQuery(/^addq:save:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === '1') return true;
    if (v === '0') return false;
  }
}

// ============ registration ============

export function registerAddSurveyConversation(composer: Composer<BotContext>): void {
  composer.use(createConversation(wizard, ADD_SURVEY_CONVERSATION_ID));
  composer.command('survey_add', async (ctx) => {
    await ctx.conversation.enter(ADD_SURVEY_CONVERSATION_ID);
  });
}

// ============ utils ============

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
