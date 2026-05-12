/**
 * Welcome-кружок (Day 4B Шаг 3): подменю, загрузка, удаление.
 * Зависимости: grammy, @grammyjs/conversations, prisma, _wizard-common.
 *
 * Подменю (callback welcome:video):
 *   - если кружка нет → [⬆️ Загрузить] [← Назад];
 *   - если есть → [🔄 Заменить] [🗑 Удалить] [← Назад].
 *
 * Загрузка/замена:
 *   1) бот просит прислать video_note,
 *   2) ловит message:video_note, забирает file_id,
 *   3) upsert'ит MediaAsset, гарантирует VIDEO_NOTE step как order=1 в
 *      дефолтном сценарии (остальные shift'аются на +1).
 *
 * Удаление:
 *   1) confirmation [Да] [Отмена];
 *   2) удаляет VIDEO_NOTE step и его MediaAsset,
 *   3) compact'ит order остальных в 1..N.
 *
 * Order-mutations идут через $transaction в две фазы (см. survey-reorder.ts)
 * чтобы не зацепиться за unique(scenarioId, order).
 */
import { Composer, InlineKeyboard } from 'grammy';
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

export const UPLOAD_WELCOME_VIDEO_CONVERSATION_ID = 'uploadWelcomeVideo';
export const DELETE_WELCOME_VIDEO_CONVERSATION_ID = 'deleteWelcomeVideo';

const PHANTOM_OFFSET = 10000;

// ============ подменю ============

export async function sendVideoSubmenu(ctx: BotContext): Promise<void> {
  const scenario = await prisma.scenario.findFirst({
    where: { isDefault: true, isActive: true },
    include: { steps: { where: { type: 'VIDEO_NOTE' }, include: { mediaAsset: true } } },
  });
  if (!scenario) {
    await ctx.reply('Дефолтный сценарий не найден.');
    return;
  }
  const videoStep = scenario.steps[0];

  const kb = new InlineKeyboard();
  if (videoStep) {
    const desc = videoStep.mediaAsset?.description ?? 'без описания';
    await ctx.reply(`🎥 <b>Welcome-кружок</b>\n\nЗагружен: <i>${escapeHtml(desc)}</i>`, {
      parse_mode: 'HTML',
      reply_markup: kb
        .text('🔄 Заменить', 'welcome:video:upload')
        .text('🗑 Удалить', 'welcome:video:delete')
        .row()
        .text('← Назад', 'admin_menu:welcome'),
    });
  } else {
    await ctx.reply('🎥 <b>Welcome-кружок</b>\n\n<i>Не загружен.</i>', {
      parse_mode: 'HTML',
      reply_markup: kb
        .text('⬆️ Загрузить', 'welcome:video:upload')
        .row()
        .text('← Назад', 'admin_menu:welcome'),
    });
  }
}

// ============ upload conversation ============

async function uploadWizard(conversation: WizardConversation, ctx: BotContext): Promise<void> {
  await ctx.reply(
    '🎥 <b>Загрузка welcome-кружка</b>\n\nПришли кружок (video note) сообщением. /cancel для отмены.',
    { parse_mode: 'HTML' },
  );

  try {
    while (true) {
      const next = await conversation.wait();
      // /cancel — текстовое сообщение
      if (next.message?.text) {
        checkCancel(next.message.text);
        await next.reply('Жду кружок (video note). /cancel для отмены.');
        continue;
      }
      if (!next.message?.video_note) {
        await next.reply('Это не video note. Пришли именно кружок (запись с круглого видео).');
        continue;
      }

      const fileId = next.message.video_note.file_id;
      const description =
        `welcome video note from admin ${ctx.user?.telegramUsername ?? ctx.user?.id ?? 'unknown'}, ` +
        new Date().toISOString();

      const scenario = await conversation.external(() =>
        prisma.scenario.findFirst({
          where: { isDefault: true, isActive: true },
          include: { steps: { orderBy: { order: 'asc' } } },
        }),
      );
      if (!scenario) {
        await ctx.reply('Дефолтный сценарий не найден.');
        return;
      }

      await conversation.external(() =>
        upsertWelcomeVideoStep(scenario.id, scenario.steps, fileId, description),
      );

      await ctx.reply('✅ Кружок сохранён. Лиды получат его перед welcome-текстами.');
      return;
    }
  } catch (err) {
    if (err instanceof CancelError) {
      await ctx.reply('Загрузка отменена.');
      return;
    }
    throw err;
  }
}

/**
 * Идемпотентно гарантирует VIDEO_NOTE step как order=1 в default сценарии.
 * Если такой step уже есть — обновляет его mediaAsset/telegramFileId.
 * Если нет — создаёт MediaAsset, создаёт Step и сдвигает существующие
 * шаги на +1 через двухфазный update (избежать unique violation).
 */
async function upsertWelcomeVideoStep(
  scenarioId: string,
  existingSteps: { id: string; type: string; order: number; mediaAssetId: string | null }[],
  telegramFileId: string,
  description: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existingVideoStep = existingSteps.find((s) => s.type === 'VIDEO_NOTE');

    if (existingVideoStep) {
      // Замена: обновляем существующий MediaAsset (если есть) или создаём новый.
      if (existingVideoStep.mediaAssetId) {
        await tx.mediaAsset.update({
          where: { id: existingVideoStep.mediaAssetId },
          data: { telegramFileId, description },
        });
      } else {
        const asset = await tx.mediaAsset.create({
          data: { type: 'VIDEO_NOTE', telegramFileId, description, isActive: true },
        });
        await tx.step.update({
          where: { id: existingVideoStep.id },
          data: { mediaAssetId: asset.id },
        });
      }
      return;
    }

    // Новая вставка: создаём MediaAsset, сдвигаем остальные шаги на +1, ставим
    // новый VIDEO_NOTE как order=1. Двухфазно — иначе unique(scenarioId, order).
    const asset = await tx.mediaAsset.create({
      data: { type: 'VIDEO_NOTE', telegramFileId, description, isActive: true },
    });
    for (const s of existingSteps) {
      await tx.step.update({
        where: { id: s.id },
        data: { order: s.order + PHANTOM_OFFSET },
      });
    }
    for (const s of existingSteps) {
      await tx.step.update({
        where: { id: s.id },
        data: { order: s.order + 1 },
      });
    }
    await tx.step.create({
      data: {
        scenarioId,
        order: 1,
        type: 'VIDEO_NOTE',
        content: {},
        mediaAssetId: asset.id,
      },
    });
  });
}

// ============ delete conversation ============

async function deleteWizard(conversation: WizardConversation, ctx: BotContext): Promise<void> {
  try {
    const confirmed = await askYesNo(
      conversation,
      ctx,
      '🗑 <b>Удалить welcome-кружок?</b>\n\nЛиды перестанут получать его перед welcome-текстами.',
      'Да, удалить',
      'Отмена',
    );
    if (!confirmed) {
      await ctx.reply('Удаление отменено.');
      return;
    }

    const scenario = await conversation.external(() =>
      prisma.scenario.findFirst({
        where: { isDefault: true, isActive: true },
        include: { steps: { orderBy: { order: 'asc' } } },
      }),
    );
    if (!scenario) {
      await ctx.reply('Дефолтный сценарий не найден.');
      return;
    }

    await conversation.external(() => removeWelcomeVideoStep(scenario.steps));
    await ctx.reply('🗑 Welcome-кружок удалён.');
  } catch (err) {
    if (err instanceof CancelError) {
      await ctx.reply('Удаление отменено.');
      return;
    }
    throw err;
  }
}

async function removeWelcomeVideoStep(
  steps: { id: string; type: string; order: number; mediaAssetId: string | null }[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const videoStep = steps.find((s) => s.type === 'VIDEO_NOTE');
    if (!videoStep) return;

    await tx.step.delete({ where: { id: videoStep.id } });

    if (videoStep.mediaAssetId) {
      await tx.mediaAsset.delete({ where: { id: videoStep.mediaAssetId } });
    }

    // Compact order остальных шагов до 1..N — двухфазно.
    const remaining = steps.filter((s) => s.id !== videoStep.id).sort((a, b) => a.order - b.order);
    for (const s of remaining) {
      await tx.step.update({
        where: { id: s.id },
        data: { order: s.order + PHANTOM_OFFSET },
      });
    }
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      if (!s) continue;
      await tx.step.update({
        where: { id: s.id },
        data: { order: i + 1 },
      });
    }
  });
}

// ============ registration ============

export function registerWelcomeVideoConversations(composer: Composer<BotContext>): void {
  composer.use(createConversation(uploadWizard, UPLOAD_WELCOME_VIDEO_CONVERSATION_ID));
  composer.use(createConversation(deleteWizard, DELETE_WELCOME_VIDEO_CONVERSATION_ID));
}
