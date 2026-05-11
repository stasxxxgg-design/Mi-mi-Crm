/**
 * Точка входа: bootstrap всех компонентов.
 * Порядок: env (валидируется на импорте) → logger → http server → bot.
 *
 * Redis-клиенты лениво поднимаются при первом импорте core/redis.
 * Здесь мы их импортируем только ради graceful shutdown.
 */
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { redis, bullmqConnection } from './core/redis.js';
import { createServer, startServer } from './server.js';
import { createBot, startBot } from './bot/index.js';

async function bootstrap(): Promise<void> {
  logger.info({ env: env.NODE_ENV, tz: env.TZ_DEFAULT }, 'Booting MIMI bot...');

  const app = await createServer();
  await startServer(app);

  const bot = createBot();
  startBot(bot);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...');
    try {
      await bot.stop();
      await app.close();
      redis.disconnect();
      bullmqConnection.disconnect();
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
    }
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Bootstrap failed');
  process.exit(1);
});
