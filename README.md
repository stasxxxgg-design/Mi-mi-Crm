# MIMI Agency Bot

Telegram-бот для агентства MIMI. Полная спецификация — в [MIMI_BOT_PRD_v3.md](MIMI_BOT_PRD_v3.md).

## Стек

Node 22 · TypeScript · Fastify · grammY · PostgreSQL · Prisma · Redis · BullMQ · Docker

## Quickstart

1. Скопируй `.env.example` в `.env` и заполни:
   ```powershell
   copy .env.example .env
   ```
   Обязательно: `BOT_TOKEN` (получи у `@BotFather`) и `INITIAL_ADMIN_TELEGRAM_ID` (твой Telegram ID, узнать у `@userinfobot`).

2. Подними postgres + redis:
   ```powershell
   docker compose up -d
   ```

3. Установи зависимости и запусти:
   ```powershell
   npm install
   npm run dev
   ```

4. Проверь, что HTTP-сервер живой:
   ```
   GET http://localhost:3000/health
   ```

5. Напиши боту в Telegram `/start` — должен ответить. Через deep link `t.me/<bot>?start=fb_test` бот залогирует payload.

## Scripts

| Команда | Что делает |
|---|---|
| `npm run dev` | Запуск в watch-режиме через tsx |
| `npm run build` | Компиляция TypeScript в `dist/` |
| `npm start` | Запуск собранного приложения |
| `npm run typecheck` | Проверка типов без сборки |
| `npm run lint` | ESLint по `src/` |
| `npm run format` | Prettier по `src/**/*.ts` |
| `npm run prisma:generate` | _(День 2+)_ Генерация Prisma Client |
| `npm run prisma:migrate` | _(День 2+)_ Применение миграций |
| `npm run prisma:seed` | _(День 2+)_ Сиды (страны, уроки, админ) |

## Структура (текущее состояние)

```
src/
├── index.ts              # entry: bootstrap()
├── server.ts             # Fastify + /health
├── config/env.ts         # zod-валидация .env
├── core/
│   ├── logger.ts         # pino
│   ├── redis.ts          # default + bullmq-клиенты
│   └── queue.ts          # BullMQ connection
└── bot/
    ├── index.ts          # grammY Bot factory
    ├── middlewares/logger.ts
    └── handlers/start.ts
```

Полная целевая структура — см. § 12 PRD.

## Прогресс

- [x] **День 1** — setup, Docker Compose, базовый бот в polling
- [ ] **День 2** — Prisma schema, миграция, seeds (страны, 12 уроков, админ)
- [ ] **День 3-4** — воронка + динамическая анкета + CMS
- [ ] **День 5-7** — база лидов с поиском
- [ ] **День 8-10** — интро-калы и tracking
- [ ] **День 11-14** — уроки и расписание

## Что НЕ реализуется на старте

См. § 14 PRD — финансовый модуль, домашки, Discord API, Google Calendar, иерархия ролей и т.д.
