/**
 * Создаёт/обновляет первого ADMIN'а из INITIAL_ADMIN_TELEGRAM_ID (.env).
 * Зависимости: @prisma/client, env.
 *
 * Если пользователь с таким telegramUserId уже есть (например, сам нажал /start
 * до миграции) — апдейтим его role до ADMIN, чтобы он не остался LEAD.
 * Профиль (LeadProfile) для админа НЕ создаётся: админ — это сотрудник, не лид.
 */
import type { PrismaClient } from '@prisma/client';

export async function setInitialAdmin(prisma: PrismaClient, telegramUserId: number): Promise<void> {
  await prisma.user.upsert({
    where: { telegramUserId: BigInt(telegramUserId) },
    update: { role: 'ADMIN' },
    create: {
      telegramUserId: BigInt(telegramUserId),
      role: 'ADMIN',
    },
  });
}
