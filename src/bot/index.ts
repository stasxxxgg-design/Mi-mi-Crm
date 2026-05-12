/**
 * grammY-бот: создание, регистрация middleware и handlers.
 * Зависимости: grammy, @grammyjs/conversations, @grammyjs/storage-redis,
 *              env, logger, redis, middlewares, handlers.
 *
 * Порядок middleware:
 *   1) loggerMiddleware           — лог всех апдейтов
 *   2) session(RedisAdapter)      — стейт для conversations 2.x
 *   3) conversations()            — даёт ctx.conversation.enter/exit/etc
 *   4) userMiddleware             — User + LeadProfile в ctx
 *   5) commands / composers       — /start, survey handlers, adminComposer
 *
 * Сессии хранятся в Redis, тот же клиент `redis` что мы используем под
 * остальное (BullMQ работает на отдельном клиенте, см. core/redis.ts).
 */
import { Bot, session } from 'grammy';
import { conversations } from '@grammyjs/conversations';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { redis } from '../core/redis.js';
import { loggerMiddleware } from './middlewares/logger.js';
import { userMiddleware } from './middlewares/user.js';
import { registerStartHandler } from './handlers/start.js';
import { registerSurveyHandlers } from './handlers/lead/survey.js';
import { createAdminComposer } from './handlers/admin/index.js';
import type { BotContext, SessionData } from './types.js';

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);

  bot.use(loggerMiddleware);

  const storage = new RedisAdapter<SessionData>({ instance: redis });
  bot.use(
    session({
      initial: (): SessionData => ({}),
      storage,
    }),
  );
  bot.use(conversations());

  bot.use(userMiddleware);

  // Команды и композеры. Порядок:
  //   - /start первым (command stops chain by default, не утечёт в survey)
  //   - lead survey handlers
  //   - админ-композер (внутри adminOnly + все /survey_*, /scenario_*, ...)
  registerStartHandler(bot);
  registerSurveyHandlers(bot);
  bot.use(createAdminComposer());

  bot.catch((err) => {
    logger.error({ err: err.error, updateId: err.ctx.update.update_id }, 'Bot handler error');
  });

  return bot;
}

/**
 * Запускает long-polling. Возвращаемый Promise резолвится только после bot.stop().
 * Вызывать без await — иначе bootstrap зависнет на этой строке.
 */
export function startBot(bot: Bot<BotContext>): void {
  void bot.start({
    onStart: (info) => logger.info({ username: info.username }, 'Bot started in polling mode'),
  });
}
