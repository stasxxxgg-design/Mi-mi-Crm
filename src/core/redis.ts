/**
 * Singleton'ы Redis-клиентов.
 * Зависимости: ioredis, env, logger.
 *
 * `redis` — обычный клиент для кэша / локов / pub-sub.
 * `bullmqConnection` — отдельный клиент специально для BullMQ:
 *   BullMQ требует maxRetriesPerRequest=null, иначе блокирующие команды
 *   (BRPOPLPUSH и т.п.) падают по таймауту. Смешивать с обычным клиентом
 *   нельзя — глобально это поведение поменяет UX для всех остальных операций.
 */
import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

function createRedis(label: string, opts: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, opts);
  client.on('connect', () => logger.info({ label }, 'Redis connected'));
  client.on('error', (err) => logger.error({ label, err }, 'Redis error'));
  return client;
}

export const redis = createRedis('default');
export const bullmqConnection = createRedis('bullmq', { maxRetriesPerRequest: null });
