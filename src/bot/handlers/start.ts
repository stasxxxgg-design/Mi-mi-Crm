/**
 * Обработчик /start. День 3 — полный flow по PRD §4:
 *   - ADMIN              → служебное приветствие, без profile
 *   - новый LEAD         → создаём LeadProfile + проигрываем дефолтный сценарий
 *   - LEAD с активной анкетой → resume: отправляем текущий вопрос
 *   - LEAD после анкеты  → благодарим, ждёт интро
 *   - STREAMER (на будущее) → заглушка "ты уже в обучении"
 *
 * User-уровневый upsert делает userMiddleware, дублировать здесь не нужно.
 * sourceCode из deep link применяем только при создании LeadProfile,
 * на повторных /start не перезаписываем — первый источник важнее.
 *
 * Зависимости: grammy, prisma, scenario handler, survey handler, repository, logger.
 */
import type { Bot, CommandContext } from 'grammy';
import { prisma } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import { playScenario } from './lead/scenario.js';
import { sendQuestion } from './lead/survey.js';
import { sendAdminMenu } from './admin/menu.js';
import { getQuestionById } from '../../modules/survey/repository.js';
import type { BotContext } from '../types.js';

const MAX_SOURCE_CODE_LENGTH = 64;

export function registerStartHandler(bot: Bot<BotContext>): void {
  bot.command('start', async (ctx: CommandContext<BotContext>) => {
    if (!ctx.user) {
      // userMiddleware не смог сделать upsert. Логирует он сам, тут просто молча выходим.
      logger.warn({ updateId: ctx.update.update_id }, '/start without ctx.user');
      return;
    }

    const rawPayload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    const sourceCode =
      rawPayload && rawPayload.length <= MAX_SOURCE_CODE_LENGTH ? rawPayload : null;

    logger.info(
      {
        telegramId: ctx.user.telegramUserId,
        role: ctx.user.role,
        sourceCode,
        hasProfile: !!ctx.leadProfile,
      },
      '/start',
    );

    if (ctx.user.role === 'ADMIN') {
      await sendAdminMenu(ctx);
      return;
    }

    // С этого момента ctx.user.role === 'LEAD' (других ролей в MVP нет).

    // Стример уже на обучении — анкета не нужна (PRD §8).
    if (ctx.leadProfile?.phase === 'STREAMER') {
      await ctx.reply('Привет! Ты уже в обучении.');
      return;
    }

    // Новый лид — создаём профиль и запускаем сценарий.
    if (!ctx.leadProfile) {
      const profile = await prisma.leadProfile.create({
        data: { userId: ctx.user.id, sourceCode, phase: 'ENTERED' },
      });
      await runDefaultScenario(ctx, profile.id);
      return;
    }

    // Лид в активной анкете — продолжаем с текущего вопроса (без повторения welcome).
    if (ctx.leadProfile.currentSurveyQuestionId) {
      const question = await getQuestionById(prisma, ctx.leadProfile.currentSurveyQuestionId);
      if (question) {
        await ctx.reply('С возвращением! Продолжим с того места, где остановились.');
        await sendQuestion(ctx, question);
        return;
      }
      // Вопрос внезапно исчез (админ удалил из анкеты) — даём фоллбек: проиграть сценарий заново.
      logger.warn(
        { leadProfileId: ctx.leadProfile.id, questionId: ctx.leadProfile.currentSurveyQuestionId },
        'currentSurveyQuestionId points to missing question — replaying scenario',
      );
      await runDefaultScenario(ctx, ctx.leadProfile.id);
      return;
    }

    // Лид уже прошёл анкету / приглашён / был на интро — благодарим и ждём.
    if (ctx.leadProfile.phase !== 'ENTERED') {
      await ctx.reply(
        'Спасибо, ты уже прошла анкету. В ближайшее время менеджер пришлёт ссылку на интро-кал.',
      );
      return;
    }

    // ENTERED без активного вопроса — редкое состояние (например, бот упал между
    // welcome-шагами и стартом анкеты). Безопасно: проиграть сценарий заново.
    await runDefaultScenario(ctx, ctx.leadProfile.id);
  });
}

async function runDefaultScenario(ctx: BotContext, leadProfileId: string): Promise<void> {
  const scenario = await prisma.scenario.findFirst({
    where: { isDefault: true, isActive: true },
  });
  if (!scenario) {
    logger.error('No default scenario found — check seed-scenarios');
    await ctx.reply('Привет! Я получил твою заявку — скоро менеджер свяжется с тобой.');
    return;
  }
  await playScenario(prisma, ctx, scenario.id, leadProfileId);
}
