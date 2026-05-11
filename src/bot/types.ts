/**
 * Расширенный grammY Context: подкладываем сюда User и LeadProfile,
 * чтобы хэндлеры не тянули БД повторно. Заполняется в userMiddleware.
 *
 * `user` и `leadProfile` объявлены опциональными: для апдейтов без `from`
 * (например service-уведомления) middleware пропускает upsert и оставляет
 * поля undefined. Хэндлеры, которым эти поля нужны, должны это проверять.
 */
import type { Context } from 'grammy';
import type { LeadProfile, User } from '@prisma/client';

export type BotContext = Context & {
  user?: User;
  leadProfile?: LeadProfile | null;
};
