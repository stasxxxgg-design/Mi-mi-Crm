/**
 * grammY-бот: создание, регистрация middleware и handlers.
 * Зависимости: grammy, env, logger, middlewares, handlers.
 */
import { Bot } from 'grammy';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';
import { loggerMiddleware } from './middlewares/logger.js';
import { registerStartHandler } from './handlers/start.js';

export function createBot(): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  bot.use(loggerMiddleware);
  registerStartHandler(bot);

  bot.catch((err) => {
    logger.error({ err: err.error, updateId: err.ctx.update.update_id }, 'Bot handler error');
  });

  return bot;
}

/**
 * Запускает long-polling. Возвращаемый Promise резолвится только после bot.stop().
 * Вызывать без await — иначе bootstrap зависнет на этой строке.
 */
export function startBot(bot: Bot): void {
  void bot.start({
    onStart: (info) => logger.info({ username: info.username }, 'Bot started in polling mode'),
  });
}
