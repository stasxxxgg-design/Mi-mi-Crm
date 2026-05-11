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
  // Fastify v5 ужесточил типы logger'а — наш pino instance напрямую не подходит
  // через `loggerInstance`. Для MVP отключаем встроенный логгер и логируем сами
  // через onRequest/onResponse hooks. Реальная нагрузка на /health пренебрежима,
  // request-логи пригодятся когда добавится /m/:token в дне 8+.
  const app = Fastify({ logger: false });

  app.addHook('onResponse', async (req, reply) => {
    logger.debug(
      {
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        ms: reply.elapsedTime,
      },
      'http.response',
    );
  });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  return app;
}

export async function startServer(app: FastifyInstance): Promise<void> {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'HTTP server started');
}
