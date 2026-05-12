/**
 * Админ-команда /survey — главная панель анкеты (Day 4A Шаг 2, обновлено Шаг 4).
 * Зависимости: grammy, prisma, survey repository, survey-add/-edit conversations.
 *
 * Список вопросов рендерится HTML-блоком, под ним идёт кнопочное меню:
 *   - для каждого активного вопроса — кнопка [N. key], которая открывает
 *     edit-меню через ctx.conversation.enter
 *   - для архивных — отдельный раздел, кнопки тоже ведут в edit (где можно
 *     [📤 Восстановить])
 *   - снизу [➕ Добавить] [↕ Порядок]
 *
 * Команды /survey_add /survey_edit /survey_remove /survey_reorder работают
 * параллельно как shortcut'ы, но первичный путь — через кнопки.
 */
import { Composer, InlineKeyboard } from 'grammy';
import type { SurveyQuestion } from '@prisma/client';
import { prisma } from '../../../core/db.js';
import { listAllGlobalQuestions } from '../../../modules/survey/repository.js';
import { ADD_SURVEY_CONVERSATION_ID } from './survey-add.js';
import { EDIT_SURVEY_CONVERSATION_ID } from './survey-edit.js';
import { REORDER_SURVEY_CONVERSATION_ID } from './survey-reorder.js';
import type { BotContext } from '../../types.js';

type ChoiceOption = { label: string; value: string };
type NumberValidation = { min?: number; max?: number };
type TextValidation = { maxLength?: number };

const CALLBACK_PREFIX = 'survey_admin:';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function registerSurveyAdminHandlers(composer: Composer<BotContext>): void {
  composer.command('survey', async (ctx) => {
    await sendSurveyPanel(ctx);
  });

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
      await ctx.conversation.enter(REORDER_SURVEY_CONVERSATION_ID);
      return;
    }
    if (action.startsWith('open:')) {
      const key = action.slice('open:'.length);
      if (key) {
        await ctx.conversation.enter(EDIT_SURVEY_CONVERSATION_ID, key);
      }
      return;
    }
  });
}

// ============ panel ============

export async function sendSurveyPanel(ctx: BotContext): Promise<void> {
  const questions = await listAllGlobalQuestions(prisma);
  const active = questions.filter((q) => q.isActive);
  const archived = questions.filter((q) => !q.isActive);

  if (active.length === 0 && archived.length === 0) {
    await ctx.reply(
      '📋 Анкета пустая.\n\nДобавь первый вопрос — нажми кнопку ниже или /survey_add.',
      {
        reply_markup: new InlineKeyboard().text('➕ Добавить вопрос', `${CALLBACK_PREFIX}add`),
      },
    );
    return;
  }

  const text = renderSurvey(active, archived);
  const kb = buildKeyboard(active, archived);
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

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
  lines.push('<i>Нажми на вопрос ниже чтобы изменить, или используй команды.</i>');
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
  if (q.hint) lines.push(`<i>Подсказка: ${escapeHtml(q.hint)}</i>`);

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

function buildKeyboard(active: SurveyQuestion[], archived: SurveyQuestion[]): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Активные — по 2 кнопки в строку, чтобы не растягивать вертикально.
  for (let i = 0; i < active.length; i += 2) {
    const q1 = active[i];
    if (!q1) continue;
    kb.text(`${q1.order}. ${q1.key}`, `${CALLBACK_PREFIX}open:${q1.key}`);
    const q2 = active[i + 1];
    if (q2) {
      kb.text(`${q2.order}. ${q2.key}`, `${CALLBACK_PREFIX}open:${q2.key}`);
    }
    kb.row();
  }

  // Архивные — с префиксом 🗂 чтобы визуально отличались.
  for (let i = 0; i < archived.length; i += 2) {
    const q1 = archived[i];
    if (!q1) continue;
    kb.text(`🗂 ${q1.key}`, `${CALLBACK_PREFIX}open:${q1.key}`);
    const q2 = archived[i + 1];
    if (q2) {
      kb.text(`🗂 ${q2.key}`, `${CALLBACK_PREFIX}open:${q2.key}`);
    }
    kb.row();
  }

  kb.text('➕ Добавить', `${CALLBACK_PREFIX}add`).text('↕ Порядок', `${CALLBACK_PREFIX}reorder`);
  return kb;
}
