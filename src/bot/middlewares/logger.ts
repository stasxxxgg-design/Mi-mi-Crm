/**
 * Логирование каждого входящего апдейта Telegram.
 * Зависимости: grammy, logger.
 */
import type { Context, NextFunction } from 'grammy';
import { logger } from '../../core/logger.js';

export async function loggerMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const start = Date.now();
  logger.debug(
    {
      updateId: ctx.update.update_id,
      type: ctx.updateType,
      from: ctx.from?.username ?? ctx.from?.id,
    },
    'Update received',
  );
  await next();
  logger.debug({ updateId: ctx.update.update_id, ms: Date.now() - start }, 'Update handled');
}
