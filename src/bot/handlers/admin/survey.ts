/**
 * Админ-команды управления анкетой (PRD §5.4).
 * Зависимости: grammy, prisma, survey repository.
 *
 * День 4A прогресс:
 *   - /survey         — этот файл (просмотр)
 *   - /survey_add     — TODO следующий шаг
 *   - /survey_edit    — TODO
 *   - /survey_remove  — TODO
 *   - /survey_reorder — TODO
 *
 * Пока кнопки "Добавить вопрос" / "Изменить порядок" отвечают подсказкой
 * "используй /survey_add" — реальный enter в conversation подключим в Шаге 3.
 */
import { Composer, InlineKeyboard } from 'grammy';
import type { SurveyQuestion } from '@prisma/client';
import { prisma } from '../../../core/db.js';
import { listAllGlobalQuestions } from '../../../modules/survey/repository.js';
import { ADD_SURVEY_CONVERSATION_ID } from './survey-add.js';
import type { BotContext } from '../../types.js';

// Telegram HTML понимает & < > — этого достаточно для парсинга.
// Кавычки экранировать не надо, мы не вкладываем строки в атрибуты.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type ChoiceOption = { label: string; value: string };
type NumberValidation = { min?: number; max?: number };
type TextValidation = { maxLength?: number };

const CALLBACK_PREFIX = 'survey_admin:';

export function registerSurveyAdminHandlers(composer: Composer<BotContext>): void {
  composer.command('survey', async (ctx) => {
    const questions = await listAllGlobalQuestions(prisma);
    const active = questions.filter((q) => q.isActive);
    const archived = questions.filter((q) => !q.isActive);

    if (active.length === 0 && archived.length === 0) {
      await ctx.reply(
        '📋 Анкета пустая.\n\nДобавь первый вопрос — нажми кнопку ниже или используй /survey_add.',
        {
          reply_markup: new InlineKeyboard().text('➕ Добавить вопрос', `${CALLBACK_PREFIX}add`),
        },
      );
      return;
    }

    const text = renderSurvey(active, archived);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text('➕ Добавить вопрос', `${CALLBACK_PREFIX}add`)
        .text('↕ Изменить порядок', `${CALLBACK_PREFIX}reorder`),
    });
  });

  // Кнопки-заглушки — реальный enter в conversation подключим в Шагах 3 и 6.
  composer.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(CALLBACK_PREFIX)) {
      await next();
      return;
    }
    await ctx.answerCallbackQuery();

    const action = data.slice(CALLBACK_PREFIX.length);
    if (action === 'add') {
      await ctx.conversation.enter(ADD_SURVEY_CONVERSATION_ID);
      return;
    }
    if (action === 'reorder') {
      // TODO Шаг 6: enter в reorder-conversation, пока — текстовая подсказка.
      await ctx.reply('Используй команду <code>/survey_reorder</code>.', { parse_mode: 'HTML' });
      return;
    }
  });
}

// ============ render ============

function renderSurvey(active: SurveyQuestion[], archived: SurveyQuestion[]): string {
  const lines: string[] = [];
  lines.push(`<b>📋 Анкета (${active.length} активных)</b>`);
  lines.push('');

  for (const q of active) {
    lines.push(...renderQuestion(q));
    lines.push('');
  }

  if (archived.length > 0) {
    lines.push(`<b>🗂 Архивные (${archived.length})</b>`);
    for (const q of archived) {
      lines.push(
        `• <code>${escapeHtml(q.key)}</code> · ${q.type} — "${escapeHtml(q.question)}"`,
      );
    }
    lines.push('');
  }

  lines.push('—');
  lines.push(
    '<i>Команды: /survey_add · /survey_edit &lt;key&gt; · /survey_remove &lt;key&gt; · /survey_reorder</i>',
  );
  return lines.join('\n');
}

function renderQuestion(q: SurveyQuestion): string[] {
  const lines: string[] = [];

  const flags: string[] = [q.type];
  if (q.isCountryQuestion) flags.push('🌍');
  flags.push(q.isRequired ? 'обязательный' : 'необязательный');
  if (q.isCountryQuestion) flags.push('country-вопрос');

  lines.push(`<b>${q.order}.</b> <code>${escapeHtml(q.key)}</code> · ${flags.join(' · ')}`);
  lines.push(escapeHtml(q.question));

  if (q.hint) {
    lines.push(`<i>Подсказка: ${escapeHtml(q.hint)}</i>`);
  }

  if (q.type === 'CHOICE') {
    const options = (q.options as ChoiceOption[] | null) ?? [];
    if (options.length > 0) {
      lines.push('<i>Варианты:</i>');
      for (const opt of options) {
        lines.push(`• ${escapeHtml(opt.label)} → <code>${escapeHtml(opt.value)}</code>`);
      }
    }
  } else if (q.type === 'NUMBER') {
    const v = (q.validation as NumberValidation | null) ?? {};
    if (v.min !== undefined && v.max !== undefined) {
      lines.push(`<i>Диапазон: ${v.min}–${v.max}</i>`);
    } else if (v.min !== undefined) {
      lines.push(`<i>Минимум: ${v.min}</i>`);
    } else if (v.max !== undefined) {
      lines.push(`<i>Максимум: ${v.max}</i>`);
    }
  } else if (q.type === 'TEXT') {
    const v = (q.validation as TextValidation | null) ?? {};
    if (v.maxLength !== undefined) {
      lines.push(`<i>Max длина: ${v.maxLength}</i>`);
    }
  }

  return lines;
}
