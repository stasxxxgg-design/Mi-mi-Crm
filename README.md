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
prisma/
├── schema.prisma                  # полная схема по PRD §11 (pg_trgm + fuzzystrmatch)
├── migrations/                    # init + day3_survey_state + enable_fuzzystrmatch
└── seed.ts                        # orchestrator

scripts/
├── seed-countries.ts              # 20 стран с aliases / TZ / flag
├── seed-survey.ts                 # 4 дефолтных вопроса
├── seed-lessons.ts                # 15 уроков (1-15)
├── seed-scenarios.ts              # default scenario: 2 TEXT + SURVEY-маркер
└── set-admin.ts                   # первый ADMIN из env

src/
├── index.ts                       # entry: bootstrap()
├── server.ts                      # Fastify + /health
├── config/env.ts                  # zod-валидация .env
├── core/
│   ├── logger.ts                  # pino
│   ├── db.ts                      # PrismaClient singleton
│   ├── redis.ts                   # default + bullmq-клиенты
│   └── queue.ts                   # BullMQ connection
├── modules/
│   ├── audit/log.ts               # funnel-events в AuditLog
│   ├── survey/
│   │   ├── repository.ts          # доступ к SurveyQuestion + JSON-мерж
│   │   ├── validator.ts           # NUMBER/CHOICE/TEXT
│   │   ├── engine.ts              # стейт-машина (failedAttempts, advance)
│   │   └── country.ts             # UI flow страны: pick/other/text/confirm/reject
│   └── timezones/
│       ├── resolver.ts            # exact-match по name/aliases
│       └── fuzzy.ts               # каскад exact → Levenshtein → trigram
└── bot/
    ├── index.ts                   # grammY Bot factory + session + conversations
    ├── types.ts                   # BotContext с user + leadProfile + session + conversation
    ├── middlewares/
    │   ├── logger.ts
    │   ├── user.ts                # upsert User + LeadProfile
    │   └── admin.ts               # adminOnly guard
    └── handlers/
        ├── start.ts               # /start: ADMIN → admin menu / lead → scenario+survey
        ├── lead/
        │   ├── scenario.ts        # playScenario: TEXT-шаги + SURVEY-маркер
        │   └── survey.ts          # рендер вопроса + callback/text диспатчер
        └── admin/
            ├── index.ts             # composer с adminOnly
            ├── menu.ts              # главное меню (/admin или /start ADMIN)
            ├── survey.ts            # /survey panel (per-question кнопки)
            ├── survey-add.ts        # 10-шаговый wizard добавления
            ├── survey-edit.ts       # меню действий + edit + archive/restore
            ├── survey-reorder.ts    # порядок через keys, two-phase update
            ├── welcome.ts           # раздел "Приветствие": панель + роутинг
            ├── welcome-edit-text.ts # редактирование одного TEXT-шага
            ├── welcome-video.ts     # кружок Маши: upload / replace / delete
            └── _wizard-common.ts    # общие ask* helpers + CancelError
```

Полная целевая структура — см. § 12 PRD.

## Прогресс

- [x] **День 1** — setup, Docker Compose, базовый бот в polling
- [x] **День 2** — Prisma schema, миграция, seeds (20 стран, 4 вопроса анкеты, 15 уроков, первый ADMIN), `/start` пишет в БД
- [x] **День 3** — движок анкеты + страны с fuzzy match (Levenshtein + trigram), audit log, e2e smoke на 11 сценариев
- [x] **День 4A** — админ-меню анкеты через @grammyjs/conversations: /survey (panel с кнопками per-question) + /survey_add (10-шаговый wizard) + /survey_edit (меню действий: текст/подсказка/тип/варианты/валидация/обязательность/порядок/country/архивация-восстановление) + /survey_remove + /survey_reorder (two-phase update)
- [x] **День 4B** — раздел «Приветствие»: панель статуса + редактирование TEXT-шагов + welcome-кружок (upload/replace/delete с two-phase reordering) + рендер VIDEO_NOTE в playScenario
- [ ] **День 5-7** — база лидов с поиском
- [ ] **День 8-10** — интро-калы и tracking
- [ ] **День 11-14** — уроки и расписание

## Что НЕ реализуется на старте

См. § 14 PRD — финансовый модуль, домашки, Discord API, Google Calendar, иерархия ролей и т.д.
