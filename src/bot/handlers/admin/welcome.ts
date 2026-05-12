/**
 * Раздел админ-меню «Приветствие» (Day 4B Шаг 1).
 * Зависимости: grammy, prisma, BotContext.
 *
 * Что админ видит:
 *   - статус welcome-кружка (есть / нет),
 *   - все TEXT-шаги дефолтного сценария по порядку,
 *   - финальный шаг "запуск анкеты" — отмечен, не редактируется.
 *
 * Кнопки:
 *   - [🎥 Кружок]      — управление видео-нотой (Шаг 3 Day 4B)
 *   - [📝 Текст N]     — редактирование конкретного TEXT-шага (Шаг 2 Day 4B)
 *   - [← Назад]        — обратно в админ-меню (admin_menu:main)
 *
 * Шаг 1 только рендерит панель — edit-кнопки сейчас отвечают
 * заглушками, чтобы layout был виден целиком.
 *
 * Callback namespace `welcome:*` чтобы не конфликтовать с другими разделами.
 */
import { Composer, InlineKeyboard } from 'grammy';
import { prisma } from '../../../core/db.js';
import type { BotContext } from '../../types.js';
import { EDIT_WELCOME_TEXT_CONVERSATION_ID } from './welcome-edit-text.js';

const CALLBACK_PREFIX = 'welcome:';

type TextStepContent = { text: string; parseMode?: 'HTML' };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendWelcomePanel(ctx: BotContext): Promise<void> {
  const scenario = await prisma.scenario.findFirst({
    where: { isDefault: true, isActive: true },
    include: {
      steps: {
        orderBy: { order: 'asc' },
        include: { mediaAsset: true },
      },
    },
  });
  if (!scenario) {
    await ctx.reply(
      'Дефолтный сценарий не найден в БД. Запусти <code>npm run prisma:seed</code>.',
      { parse_mode: 'HTML' },
    );
    return;
  }

  const videoStep = scenario.steps.find((s) => s.type === 'VIDEO_NOTE');
  const textSteps = scenario.steps.filter((s) => s.type === 'TEXT');
  const surveyStep = scenario.steps.find((s) => s.type === 'SURVEY');

  const lines: string[] = [];
  lines.push('<b>👋 Приветствие</b>');
  lines.push('<i>Что лид видит после /start, перед анкетой.</i>');
  lines.push('');

  if (videoStep) {
    const desc = videoStep.mediaAsset?.description ?? '';
    lines.push(`🎥 <b>Кружок:</b> загружен${desc ? ` — <i>${escapeHtml(desc)}</i>` : ''}`);
  } else {
    lines.push('🎥 <b>Кружок:</b> <i>не загружен</i>');
  }
  lines.push('');

  if (textSteps.length === 0) {
    lines.push('<i>Текстов нет — проверь сиды.</i>');
  } else {
    textSteps.forEach((step, i) => {
      const content = step.content as TextStepContent;
      lines.push(`<b>📝 Текст ${i + 1}:</b>`);
      lines.push(escapeHtml(content?.text ?? ''));
      lines.push('');
    });
  }

  if (surveyStep) {
    lines.push('<i>▶ запуск анкеты (не редактируется)</i>');
  }

  const kb = new InlineKeyboard();
  kb.text('🎥 Кружок', `${CALLBACK_PREFIX}video`).row();
  textSteps.forEach((step, i) => {
    kb.text(`📝 Текст ${i + 1}`, `${CALLBACK_PREFIX}text:${step.id}`);
  });
  if (textSteps.length > 0) kb.row();
  kb.text('← Назад', 'admin_menu:main');

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

export function registerWelcomeAdminHandlers(composer: Composer<BotContext>): void {
  composer.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(CALLBACK_PREFIX)) {
      await next();
      return;
    }
    await ctx.answerCallbackQuery();

    const action = data.slice(CALLBACK_PREFIX.length);

    if (action === 'video') {
      // TODO Day 4B Шаг 3: enter conversation для upload/replace/delete.
      await ctx.reply('🎥 Управление кружком — Day 4B Шаг 3.');
      return;
    }
    if (action.startsWith('text:')) {
      const stepId = action.slice('text:'.length);
      if (stepId) {
        await ctx.conversation.enter(EDIT_WELCOME_TEXT_CONVERSATION_ID, stepId);
      }
      return;
    }
  });
}
