/**
 * Type-safe валидация переменных окружения через zod.
 * Зависимости: dotenv, zod.
 *
 * Импортируй типизированный объект `env` вместо process.env во всём коде.
 * При невалидном .env процесс падает на старте — лучше ранний фейл, чем runtime-сюрприз.
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),

  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  INITIAL_ADMIN_TELEGRAM_ID: z.coerce.number().int().positive(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  TZ_DEFAULT: z.string().default('Europe/Kyiv'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Логгер ещё не инициализирован — пишем напрямую.
  console.error('Invalid environment variables:');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
