/**
 * Upsert'ит User по telegramUserId и подкладывает его + LeadProfile в ctx.
 * Зависимости: prisma, BotContext.
 *
 * Делаем upsert на каждый update вместо findFirst+условного create:
 *  - upsert идемпотентен и атомарен (одна транзакция),
 *  - имя/username в Telegram могут поменяться — заодно обновим,
 *  - проверки "новый ли это юзер" в любом случае не дают чёткой границы:
 *    /start с deep link важнее, и эта логика осталась в start handler.
 *
 * Для админов LeadProfile = null (не создавали), для лидов — может быть
 * либо профиль, либо null (если ещё не дошёл до handler-а, который его
 * создаёт). Хэндлеры должны учитывать оба случая.
 */
import type { NextFunction } from 'grammy';
import { prisma } from '../../core/db.js';
import { logger } from '../../core/logger.js';
import type { BotContext } from '../types.js';

export async function userMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) {
    // Service-апдейты без отправителя (например channel posts) — пропускаем
    // upsert, ctx.user/leadProfile останутся undefined.
    await next();
    return;
  }

  try {
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

    ctx.user = user;
    ctx.leadProfile = user.leadProfile ?? null;
  } catch (err) {
    logger.error({ err, telegramId: from.id }, 'userMiddleware: upsert failed');
    // Не пробрасываем — продолжаем обработку. Хэндлеры, которым нужен
    // ctx.user, увидят undefined и сами решат, как реагировать.
  }

  await next();
}
