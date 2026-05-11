/**
 * Обработчик /start. На день 1 — эхо + парсинг deep-link payload.
 *
 * Запись в БД (создание User + LeadProfile, см. PRD §4) будет добавлена в день 2,
 * когда поднимем Prisma. Сейчас просто проверяем, что polling работает и
 * payload из deep link (например t.me/bot?start=fb_oct2026) корректно достаётся.
 *
 * Зависимости: grammy, logger.
 */
import type { Bot, CommandContext, Context } from 'grammy';
import { logger } from '../../core/logger.js';

export function registerStartHandler(bot: Bot): void {
  bot.command('start', async (ctx: CommandContext<Context>) => {
    const payload = ctx.match || null;

    logger.info(
      {
        telegramId: ctx.from?.id,
        username: ctx.from?.username,
        payload,
      },
      'Start command',
    );

    const greeting = payload
      ? `Привет! Получил тебя через источник: <b>${payload}</b>`
      : 'Привет! Бот пока в разработке.';

    await ctx.reply(greeting, { parse_mode: 'HTML' });
  });
}
