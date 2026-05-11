/**
 * Fastify HTTP-сервер.
 * Зависимости: fastify, env, logger.
 *
 * В фазе A (polling) HTTP-сервер нужен только для:
 *   - health-чека
 *   - в будущем (фаза B+) — роута /m/:token для tracking интро-калов (PRD §7.4).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { logger } from './core/logger.js';

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: logger });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  return app;
}

export async function startServer(app: FastifyInstance): Promise<void> {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'HTTP server started');
}
