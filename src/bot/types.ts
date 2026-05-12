/**
 * Расширенный grammY Context.
 *
 * Слои:
 *   1) Context        — базовый grammY
 *   2) SessionFlavor  — для conversations 2.x (хранение состояния разговоров)
 *   3) custom fields  — User + LeadProfile из userMiddleware
 *   4) ConversationFlavor — wrapper, который добавляет ctx.conversation API
 *
 * Заполнение:
 *   - user, leadProfile — userMiddleware
 *   - session — session middleware с RedisAdapter
 *   - conversation — conversations() middleware
 */
import type { Context, SessionFlavor } from 'grammy';
import type { ConversationFlavor } from '@grammyjs/conversations';
import type { LeadProfile, User } from '@prisma/client';

// Пока сессия не хранит ничего своего — все wizard'ы кладут стейт через
// conversations plugin. Структуру SessionData оставляем пустой, чтобы
// в будущем можно было добавить флаги без конфликта.
export interface SessionData {}

type BaseContext = Context &
  SessionFlavor<SessionData> & {
    user?: User;
    leadProfile?: LeadProfile | null;
  };

export type BotContext = ConversationFlavor<BaseContext>;
