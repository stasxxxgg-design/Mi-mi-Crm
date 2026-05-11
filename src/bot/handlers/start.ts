/**
 * Обработчик /start. День 2 — подключение к БД (PRD §4):
 *   - findOrCreate User по telegramUserId
 *   - если новый лид (роль LEAD без LeadProfile) — создаём профиль
 *     с sourceCode из deep link и phase=ENTERED
 *   - админам не создаём LeadProfile (они сотрудники, не лиды)
 *
 * Воронка (welcome-кружок, анкета) подключается в днях 3-4, сейчас просто
 * вежливое приветствие и фиксация в БД.
 *
 * Зависимости: grammy, prisma, logger.
 */
import type { Bot, CommandContext, Context } from 'grammy';
import { prisma } from '../../core/db.js';
import { logger } from '../../core/logger.js';

const MAX_SOURCE_CODE_LENGTH = 64; // защита от мусорного payload

export function registerStartHandler(bot: Bot): void {
  bot.command('start', async (ctx: CommandContext<Context>) => {
    const from = ctx.from;
    if (!from) {
      logger.warn({ updateId: ctx.update.update_id }, '/start without from — skipping');
      return;
    }

    // ctx.match содержит payload после "/start " (например "fb_oct2026").
    // Защищаемся от длинных строк и пустых значений.
    const rawPayload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
    const sourceCode = rawPayload && rawPayload.length <= MAX_SOURCE_CODE_LENGTH ? rawPayload : null;

    const user = await prisma.user.upsert({
      where: { telegramUserId: BigInt(from.id) },
      update: {
        telegramUsername: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
      },
      create: {
        telegramUserId: BigInt(from.id),
        telegramUsername: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        role: 'LEAD',
      },
      include: { leadProfile: true },
    });

    // Профиль создаём только лидам и только если ещё нет.
    // Админам profile не нужен — они сотрудники команды.
    let isNewLead = false;
    if (user.role === 'LEAD' && !user.leadProfile) {
      await prisma.leadProfile.create({
        data: {
          userId: user.id,
          sourceCode,
          phase: 'ENTERED',
        },
      });
      isNewLead = true;
    }

    logger.info(
      {
        telegramId: from.id,
        username: from.username,
        role: user.role,
        sourceCode,
        isNewLead,
      },
      '/start handled',
    );

    if (user.role === 'ADMIN') {
      await ctx.reply('Привет, админ. Бот в разработке. Команды появятся в днях 5-7.');
      return;
    }

    if (isNewLead) {
      const intro = sourceCode
        ? `Привет! Спасибо, что заглянула (источник: <b>${sourceCode}</b>).\n\nЯ бот агентства <b>MIMI</b>. Скоро здесь будут вопросы для знакомства.`
        : 'Привет! Я бот агентства <b>MIMI</b>. Скоро здесь будут вопросы для знакомства.';
      await ctx.reply(intro, { parse_mode: 'HTML' });
      return;
    }

    await ctx.reply('С возвращением! Анкета и воронка ещё на стройке — скоро доделаем.');
  });
}
