/**
 * Воспроизведение шагов сценария для лида (PRD §4).
 * Зависимости: grammy, prisma, survey engine, survey handler.
 *
 * На день 3 умеем только TEXT + SURVEY. Остальные типы (PHOTO, VIDEO_NOTE,
 * VOICE, BUTTONS, DELAY) логируются с предупреждением и пропускаются —
 * их обработка появится в дне 4 (CMS / media upload).
 *
 * delayAfterSeconds игнорируется на день 3: все шаги дефолтного сценария
 * сидируются с 0, реальный delay-runner с BullMQ — день 4.
 *
 * SURVEY-шаг — терминальный: после него анкета берёт управление через
 * survey handler'ы, остальные шаги (если бы они шли после SURVEY) не
 * проиграются.
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
  });

  for (const step of steps) {
    if (step.type === 'TEXT') {
      const content = step.content as TextStepContent;
      await ctx.reply(content.text, {
        parse_mode: content.parseMode ?? 'HTML',
      });
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
