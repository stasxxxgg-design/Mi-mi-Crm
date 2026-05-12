/**
 * Wizard "📝 Текст N" — редактирование TEXT-шага дефолтного сценария.
 * Зависимости: grammy, @grammyjs/conversations, prisma, _wizard-common.
 *
 * Один input + подтверждение. Не делаем длинного многошагового потока:
 *   - показать текущий текст,
 *   - попросить новый,
 *   - превью + кнопки [✅ Сохранить] / [❌ Отмена],
 *   - на save — update step.content = { text, parseMode: 'HTML' }.
 *
 * Лимит длины 1000 символов: меньше Telegram-cap (4096) с запасом на
 * случай вставки HTML-тегов из copy-paste.
 */
import type { Composer } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { prisma } from '../../../core/db.js';
import type { BotContext } from '../../types.js';
import {
  CancelError,
  askYesNo,
  checkCancel,
  escapeHtml,
  type WizardConversation,
} from './_wizard-common.js';

export const EDIT_WELCOME_TEXT_CONVERSATION_ID = 'editWelcomeText';

const MAX_LENGTH = 1000;

async function wizard(
  conversation: WizardConversation,
  ctx: BotContext,
  stepId: string,
): Promise<void> {
  const step = await conversation.external(() =>
    prisma.step.findUnique({ where: { id: stepId } }),
  );
  if (!step || step.type !== 'TEXT') {
    await ctx.reply('Шаг не найден или это не текстовый шаг.');
    return;
  }

  const currentContent = step.content as { text?: string } | null;
  const currentText = currentContent?.text ?? '';

  await ctx.reply(
    [
      '<b>📝 Редактирование welcome-текста</b>',
      '',
      '<b>Сейчас:</b>',
      escapeHtml(currentText),
      '',
      `Введи новый текст (до ${MAX_LENGTH} символов) или /cancel для отмены.`,
    ].join('\n'),
    { parse_mode: 'HTML' },
  );

  try {
    while (true) {
      const next = await conversation.waitFor('message:text');
      const newText = next.message.text.trim();
      checkCancel(newText);

      if (!newText) {
        await next.reply('Пусто. Введи текст или /cancel.');
        continue;
      }
      if (newText.length > MAX_LENGTH) {
        await next.reply(`Слишком длинно (${newText.length} > ${MAX_LENGTH}). Попробуй короче или /cancel.`);
        continue;
      }

      const confirmed = await askYesNo(
        conversation,
        ctx,
        ['<b>Сохранить?</b>', '', escapeHtml(newText)].join('\n'),
        '✅ Сохранить',
        '❌ Отмена',
      );
      if (!confirmed) {
        await ctx.reply('Сохранение отменено.');
        return;
      }

      await conversation.external(() =>
        prisma.step.update({
          where: { id: stepId },
          data: { content: { text: newText, parseMode: 'HTML' } },
        }),
      );

      await ctx.reply('✅ Сохранено. Открой <code>/admin</code> → 👋 Приветствие чтобы убедиться.', {
        parse_mode: 'HTML',
      });
      return;
    }
  } catch (err) {
    if (err instanceof CancelError) {
      await ctx.reply('Редактирование отменено.');
      return;
    }
    throw err;
  }
}

export function registerEditWelcomeTextConversation(composer: Composer<BotContext>): void {
  composer.use(createConversation(wizard, EDIT_WELCOME_TEXT_CONVERSATION_ID));
}
