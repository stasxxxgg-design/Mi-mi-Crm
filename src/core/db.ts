/**
 * Singleton PrismaClient. Импортируй `prisma` отовсюду где нужен доступ к БД.
 * Зависимости: @prisma/client, env, logger.
 *
 * Включён лог query/info/warn в dev-режиме, в prod — только ошибки.
 */
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  log:
    env.NODE_ENV === 'development'
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
});

if (env.NODE_ENV === 'development') {
  // Уровень trace, чтобы не мусорить в обычном debug-выводе.
  prisma.$on('query', (e) => logger.trace({ query: e.query, params: e.params, ms: e.duration }, 'prisma.query'));
}
prisma.$on('warn', (e) => logger.warn({ message: e.message }, 'prisma.warn'));
prisma.$on('error', (e) => logger.error({ message: e.message }, 'prisma.error'));
