/**
 * adminOnly middleware: пропускает дальше только пользователей с role=ADMIN.
 * Зависимости: BotContext, logger.
 *
 * Поведение для не-админа:
 *   - WARN-лог с telegramId и role (если есть)
 *   - реплай "Эта команда только для администраторов." — НЕ молча,
 *     иначе тестируя на лиде непонятно почему ничего не происходит
 *
 * Если ctx.user не загружен (userMiddleware упал) — тоже отказ.
 */
import type { NextFunction } from 'grammy';
import { logger } from '../../core/logger.js';
import type { BotContext } from '../types.js';

export async function adminOnly(ctx: BotContext, next: NextFunction): Promise<void> {
  if (ctx.user?.role !== 'ADMIN') {
    logger.warn(
      { telegramId: ctx.from?.id, role: ctx.user?.role ?? null },
      'Non-admin tried admin route',
    );
    await ctx.reply('Эта команда только для администраторов.');
    return;
  }
  await next();
}
