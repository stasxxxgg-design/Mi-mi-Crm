/**
 * Общие helper'ы для админ-wizard'ов: ask*-функции, CancelError, html-escape.
 * Используются /survey_add (Шаг 3), /survey_edit (Шаг 4) и далее.
 *
 * Зависимости: grammy, @grammyjs/conversations, prisma, BotContext.
 *
 * Принцип: каждый askX задаёт один логический шаг + перепрашивает на невалидный
 * ввод. /cancel в любом месте — throw CancelError, обработка — в верхнем wizard.
 *
 * Все БД-операции внутри helper'ов завёрнуты в conversation.external — этого
 * требует replay-механика conversations 2.x.
 */
import { InlineKeyboard } from 'grammy';
import type { Conversation } from '@grammyjs/conversations';
import { prisma } from '../../../core/db.js';
import type { BotContext } from '../../types.js';

export type WizardConversation = Conversation<BotContext, BotContext>;

export type SupportedType = 'NUMBER' | 'TEXT' | 'CHOICE' | 'BOOLEAN';
export type ChoiceOption = { label: string; value: string };

export class CancelError extends Error {}
export function checkCancel(text: string): void {
  if (text.trim().toLowerCase() === '/cancel') throw new CancelError();
}

/** Экранирование HTML для Telegram parse_mode='HTML'. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============ ask helpers ============

/**
 * Уникальный snake_case ключ, 3–32, не начинается с _ (зарезервировано
 * для служебных, например _countryFlow). Уникальность проверяется в
 * scope scenarioId=null.
 */
export async function askKey(conv: WizardConversation, ctx: BotContext): Promise<string> {
  await ctx.reply(
    '<b>ключ</b>\n\nsnake_case, 3–32 символа. Не начинается с <code>_</code>.',
    { parse_mode: 'HTML' },
  );
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

export async function askQuestion(conv: WizardConversation, ctx: BotContext): Promise<string> {
  await ctx.reply('<b>текст вопроса</b>\n\nДо 500 символов.', { parse_mode: 'HTML' });
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

/** Возвращает null если /skip. */
export async function askHint(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<string | null> {
  await ctx.reply(
    '<b>подсказка</b>\n\nКурсивом под вопросом. До 500 символов или /skip.',
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

export async function askType(
  conv: WizardConversation,
  ctx: BotContext,
  promptPrefix = '<b>тип</b>',
): Promise<SupportedType> {
  const kb = new InlineKeyboard()
    .text('🔢 NUMBER', 'wiz:type:NUMBER')
    .text('📝 TEXT', 'wiz:type:TEXT')
    .row()
    .text('☑ CHOICE', 'wiz:type:CHOICE')
    .text('🟢 BOOLEAN', 'wiz:type:BOOLEAN');
  await ctx.reply(promptPrefix, { parse_mode: 'HTML', reply_markup: kb });
  while (true) {
    const next = await conv.waitForCallbackQuery(/^wiz:type:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === 'NUMBER' || v === 'TEXT' || v === 'CHOICE' || v === 'BOOLEAN') {
      return v;
    }
  }
}

export async function askOptions(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<ChoiceOption[]> {
  await ctx.reply(
    '<b>варианты ответа</b>\n\nКаждая строка вида <code>Текст|value</code>. Минимум 2.\n\nПример:\n<code>Стримила 1+ год|1plus_year\nПробовала пару раз|few_times\nНикогда|never</code>',
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
      return { ok: false, error: `Строка "${line}" — нужен формат label|value.` };
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

export async function askNumberValidation(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<Record<string, number>> {
  await ctx.reply('<b>минимум</b>\n\nЦелое число или /skip.', { parse_mode: 'HTML' });
  const min = await waitForIntOrSkip(conv);
  await ctx.reply('<b>максимум</b>\n\nЦелое число или /skip.', { parse_mode: 'HTML' });
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

export async function askTextValidation(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<Record<string, number>> {
  await ctx.reply('<b>максимальная длина</b>\n\nЦелое > 0 или /skip.', { parse_mode: 'HTML' });
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

export async function waitForIntOrSkip(conv: WizardConversation): Promise<number | null> {
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

export async function askIsRequired(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<boolean> {
  const kb = new InlineKeyboard()
    .text('Да, обязательный', 'wiz:req:1')
    .text('Нет', 'wiz:req:0');
  await ctx.reply('<b>обязательный?</b>', { parse_mode: 'HTML', reply_markup: kb });
  while (true) {
    const next = await conv.waitForCallbackQuery(/^wiz:req:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === '1') return true;
    if (v === '0') return false;
  }
}

/**
 * order:
 *   - default — что подставлять в /skip (max+1 для add, текущий для edit)
 *   - excludeId — id вопроса который не считается коллизией с собой (для edit)
 */
export async function askOrder(
  conv: WizardConversation,
  ctx: BotContext,
  defaultOrder: number,
  excludeId?: string,
): Promise<number> {
  await ctx.reply(
    `<b>порядок</b>\n\nЦелое ≥ 1. Введи число или /skip чтобы оставить <code>${defaultOrder}</code>.`,
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
        where: {
          scenarioId: null,
          order: candidate,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
      }),
    );
    if (taken) {
      await next.reply(
        `Порядок ${candidate} занят вопросом <code>${escapeHtml(taken.key)}</code>. Введи другой.`,
        { parse_mode: 'HTML' },
      );
      continue;
    }
    return candidate;
  }
}

export async function askIsCountryQuestion(
  conv: WizardConversation,
  ctx: BotContext,
): Promise<boolean> {
  const kb = new InlineKeyboard()
    .text('Да, country', 'wiz:c:1')
    .text('Нет', 'wiz:c:0');
  await ctx.reply(
    '<b>country-вопрос?</b>\n\nСпец-логика с топ-странами и fuzzy-матчингом. Только если этот вопрос про страну лида.',
    { parse_mode: 'HTML', reply_markup: kb },
  );
  while (true) {
    const next = await conv.waitForCallbackQuery(/^wiz:c:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === '1') return true;
    if (v === '0') return false;
  }
}

/** Кнопочный Да/Нет — для confirmation step'ов. */
export async function askYesNo(
  conv: WizardConversation,
  ctx: BotContext,
  prompt: string,
  yesLabel = 'Да',
  noLabel = 'Нет',
): Promise<boolean> {
  const kb = new InlineKeyboard().text(yesLabel, 'wiz:yn:1').text(noLabel, 'wiz:yn:0');
  await ctx.reply(prompt, { parse_mode: 'HTML', reply_markup: kb });
  while (true) {
    const next = await conv.waitForCallbackQuery(/^wiz:yn:/);
    await next.answerCallbackQuery();
    const v = next.callbackQuery.data.split(':')[2];
    if (v === '1') return true;
    if (v === '0') return false;
  }
}
