/**
 * Воспроизведение шагов сценария для лида (PRD §4).
 * Зависимости: grammy, prisma, survey engine, survey handler.
 *
 * Поддерживаемые типы шагов:
 *   - TEXT       — ctx.reply со stored content.text;
 *   - VIDEO_NOTE — ctx.replyWithVideoNote(MediaAsset.telegramFileId);
 *   - SURVEY     — startSurvey + sendQuestion (терминальный шаг).
 *
 * Остальные (PHOTO, VOICE, BUTTONS, DELAY) пока логируются как warn и
 * пропускаются. Когда понадобятся — добавим аналогично.
 *
 * delayAfterSeconds игнорируется: настоящий delay-runner на BullMQ
 * планируется в Day 8-10 (когда понадобится для напоминаний интро-калов).
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '../../../core/logger.js';
import { startSurvey } from '../../../modules/survey/engine.js';
import { sendQuestion } from './survey.js';
import type { BotContext } from '../../types.js';

type TextStepContent = { text: string; parseMode?: 'HTML' };

export async function playScenario(
  prisma: PrismaClient,
  ctx: BotContext,
  scenarioId: string,
  leadProfileId: string,
): Promise<void> {
  const steps = await prisma.step.findMany({
    where: { scenarioId },
    orderBy: { order: 'asc' },
    include: { mediaAsset: true },
  });

  for (const step of steps) {
    if (step.type === 'TEXT') {
      const content = step.content as TextStepContent;
      await ctx.reply(content.text, {
        parse_mode: content.parseMode ?? 'HTML',
      });
      continue;
    }

    if (step.type === 'VIDEO_NOTE') {
      if (!step.mediaAsset) {
        logger.warn(
          { scenarioId, stepId: step.id },
          'VIDEO_NOTE step has no mediaAsset — skipping',
        );
        continue;
      }
      await ctx.replyWithVideoNote(step.mediaAsset.telegramFileId);
      continue;
    }

    if (step.type === 'SURVEY') {
      const result = await startSurvey(prisma, leadProfileId);
      if (result.kind === 'asked') {
        await sendQuestion(ctx, result.question);
      } else if (result.kind === 'completed') {
        await ctx.reply(
          'Похоже, у нас сейчас нет вопросов для тебя. Менеджер скоро напишет.',
        );
      }
      // SURVEY — терминал. Дальнейшие шаги (если они есть) не проигрываем.
      return;
    }

    logger.warn(
      { scenarioId, stepId: step.id, stepType: step.type },
      'Unsupported step type in scenario — skipping',
    );
  }
}
