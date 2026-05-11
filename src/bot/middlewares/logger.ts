/**
 * Логирование каждого входящего апдейта Telegram.
 * Зависимости: grammy, logger.
 */
import type { NextFunction } from 'grammy';
import { logger } from '../../core/logger.js';
import type { BotContext } from '../types.js';

export async function loggerMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const start = Date.now();
  logger.debug(
    {
      updateId: ctx.update.update_id,
      from: ctx.from?.username ?? ctx.from?.id,
      hasMessage: ctx.message !== undefined,
      hasCallback: ctx.callbackQuery !== undefined,
    },
    'Update received',
  );
  await next();
  logger.debug({ updateId: ctx.update.update_id, ms: Date.now() - start }, 'Update handled');
}
