/**
 * grammY-бот: создание, регистрация middleware и handlers.
 * Зависимости: grammy, env, logger, middlewares, handlers.
 *
 * Порядок middleware важен:
 *   1) loggerMiddleware — лог всех апдейтов до того, как handler упадёт
 *   2) userMiddleware   — кладёт User + LeadProfile в ctx, чтобы handlers
 *      не дублировали БД-запросы
 */
import { Bot } from 'grammy';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { loggerMiddleware } from './middlewares/logger.js';
import { userMiddleware } from './middlewares/user.js';
import { registerStartHandler } from './handlers/start.js';
import { registerSurveyHandlers } from './handlers/lead/survey.js';
import type { BotContext } from './types.js';

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);

  bot.use(loggerMiddleware);
  bot.use(userMiddleware);

  // Порядок важен: commands и start идут первыми, чтобы /start не попал в
  // message:text-обработчик survey. grammy command-хэндлеры останавливают
  // chain по умолчанию (без next), так что они отрабатывают первыми и
  // эксклюзивно.
  registerStartHandler(bot);
  registerSurveyHandlers(bot);

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
