/**
 * Базовая инфраструктура BullMQ. Сами очереди будут добавляться по мере фич:
 *   - intro-reminders (день 8-10)
 *   - lesson-reminders (день 11-14)
 *   - recurring-english (день 11-14)
 *
 * На день 1 — только экспорт общего connection-объекта, чтобы убедиться,
 * что Redis-соединение для BullMQ инициализируется без ошибок.
 *
 * Зависимости: bullmq, redis.
 */
import type { ConnectionOptions } from 'bullmq';
import { bullmqConnection } from './redis.js';

export const queueConnection: ConnectionOptions = bullmqConnection;
