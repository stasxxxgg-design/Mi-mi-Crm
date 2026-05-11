# MIMI Agency Bot — PRD v3.0 (Lean MVP)

**Версия:** 3.0 (минималистичная, после упрощения)
**Дата:** Май 2026
**Назначение:** Техническая спецификация для MVP + промт для Claude Code

> Это финальная упрощённая версия. Делаем минимум на старте, но архитектура заложена под расширение.

---

## 0. TL;DR

Telegram-бот для агентства TikTok-стримеров **MIMI Agency**. На старте — **гибкая база лидов с поиском** + **воронка** + **расписание уроков с напоминаниями**. Всё остальное (финансы, домашки, Discord-интеграция, ревью эфиров) — на потом, заложено в схеме БД, но не реализовано.

**Главное в MVP:**
1. База лидов с поиском по любым полям и комбинации тэгов
2. Простая воронка: приветственный кружок → анкета → ожидание интро
3. Интро-калы: бот сам шлёт ссылку и напоминания, в том числе если лид не кликнул
4. Расписание уроков с автоматическими напоминаниями (без Google Calendar)
5. Автоматический учёт часовых поясов лидов
6. Карточка лида = центральный объект, всё крутится вокруг неё

**Стек:** Node.js + TypeScript + Fastify + grammY + PostgreSQL + Prisma + Redis + BullMQ + Docker
**Старт:** 0$, локально на ноутбуке, polling-режим
**Дальше:** Oracle Cloud Free Tier (0$) → Hetzner $5 когда нужна стабильность

---

## 1. Бизнес-контекст (кратко)

**MIMI Agency** — TikTok-агентство, обучающее стримеров. Команда 10+ человек: владелец, менеджеры, отдельный преподаватель английского. Стас и его девушка — менеджеры.

**Цикл клиента:**
1. Реклама → лид заходит в бота
2. Анкета → лид в базе
3. Интро-кал в Google Meet (групповой)
4. Менеджер создаёт TikTok-аккаунт для лида
5. Лид становится стримером, идёт обучение по 12 урокам
6. После обучения — поддержка, разборы, английский раз в неделю

**Рабочее время:** Пн 10:00-18:00 Киев, Вт-Пт 11:00-19:00 Киев.

---

## 2. Архитектурные принципы

1. **Карточка лида/стримера — центральная сущность.** Всё крутится вокруг неё. Поиск, фильтрация, тэги — приоритет №1 в MVP.
2. **Контент в БД, не в коде.** Кружки, тексты приветствия, тексты уроков — всё редактируется через бот, никаких деплоев.
3. **Заложить место под будущее в схеме БД.** Финансы, домашки, Discord — таблицы есть, но не используются в MVP. Это даёт гибкость без миграций.
4. **Минимум магии.** Бот хранит расписание, шлёт напоминания. НЕ автоматизирует то, что делается легко вручную (одобрение, расписание уроков, перевод в стримеры).
5. **Polling-режим на старте.** Никаких webhook'ов, доменов, HTTPS на фазе разработки.
6. **Один сценарий по умолчанию + гибкость под несколько.** Создаём CMS-структуру сразу, но в MVP используем один сценарий. Когда нужны разные — просто добавляем через бота.
7. **Один тип роли — `ADMIN`** для всех сотрудников MIMI. Лиды и стримеры — это **статусы карточки**, а не отдельные роли с UI.
8. **Минимум автоматических уведомлений.** На старте бот молчит лишний раз. Шлёт только: напоминания о созвонах, напоминания о уроках.

---

## 3. Стек и инфраструктура

| Слой | Технология | Обоснование |
|---|---|---|
| Язык | TypeScript 5.x | Типобезопасность |
| Runtime | Node.js 22 LTS | Стабильность |
| HTTP | Fastify | Лёгкий, быстрый |
| Bot SDK | grammY | Современный, лучший TS-саппорт |
| ORM | Prisma | Type-safe миграции |
| БД | PostgreSQL 16 | JSONB, FTS, надёжность |
| Очереди | BullMQ + Redis 7 | Для отложенных напоминаний |
| Логи | pino | JSON-логгер |
| Конфиг | dotenv + zod | Type-safe env |
| Контейнеры | Docker + Compose | Простой деплой |

**Инфраструктура (поэтапно, 0$ на старте):**
- **Фаза A** (разработка): локально, ноутбук, polling
- **Фаза B** (beta 24/7): Oracle Cloud Free Tier + DuckDNS, 0$
- **Фаза C** (production): Hetzner CPX11 + платный домен, ~$5-10/мес — **когда команда зависит от стабильности**

Архитектура одинакова на всех фазах — миграция = смена `.env`.

---

## 4. Воронка лида (упрощённая)

```
[Реклама] → t.me/mimi_bot?start=fb_oct2026
    ↓
[Phase: ENTERED] Создание User + LeadProfile
    ↓
[Welcome кружок] Приветственное видео от Маши (управляется через бот)
    ↓
[Welcome текст] "Мы агентство... расскажу как это работает"
    ↓
[Динамическая анкета — управляется через админку]:
  Вопросы хранятся в БД, редактируются админами без деплоя.
  
  Стартовый набор (4 вопроса):
  1. 🎂 Возраст (число, 16-60)
  2. 📺 Опыт в стримах (кнопки):
     - Стримила 1+ год
     - Пробовала пару раз
     - Никогда
  3. 🌍 Страна проживания (кнопки топ-стран + "Другое" с текстовым вводом):
     - Украина / Беларусь / Польша / Россия / Другое
     - При "Другое" — fuzzy matching по опечаткам
  4. 📱 Модель телефона (текст, с подсказкой про рекомендацию iPhone 13+)
    ↓
[Phase: TASK_COMPLETED]
    ↓
Бот определяет часовой пояс лида по стране
    ↓
[Карточка лида в БД] — админы видят в /leads
    ↓
Бот лиду: "Спасибо! В ближайшее время скинем ссылку на знакомство"
    ↓
═════════ Дальше — действия админа ═════════
    ↓
Админ создаёт IntroCall: дата, время (по Киеву), общая Meet-ссылка
    ↓
Админ добавляет лидов в этот интро-кал
    ↓
Бот за 15 мин до созвона (в TZ лида!): шлёт ссылку
    ↓
Лид кликает → tracking → редирект на Meet
    ↓
Если за 5 мин до встречи не кликнул → бот шлёт лиду напоминалку (НЕ менеджеру)
    ↓
[Phase: MEET_INVITED → MEET_ATTENDED / MEET_MISSED]
    ↓
Админ списывается с пришедшими, создаёт TikTok-аккаунт
    ↓
Админ в боте нажимает "Перевести в стримера"
    ↓
[Phase: STREAMER, currentLesson: 0]
    ↓
Менеджер планирует первый урок → бот шлёт напоминание стримеру и менеджеру
```

---

## 5. База лидов — главная фича MVP

### 5.1 Поля карточки

**Автоматически из Telegram:**
- `telegramUserId` (уникальный)
- `telegramUsername` (может меняться)
- `firstName` / `lastName` (из профиля TG)
- `createdAt` (дата регистрации в боте)
- `sourceCode` (из deep link, например `fb_oct2026`)

**Из анкеты (хранится как JSON, состав редактируется через админку):**
- `surveyAnswers` (JSONB): объект с ответами по ключам вопросов
  ```json
  {
    "age": 22,
    "tt_experience": "Стримила 1+ год",
    "country": "Польша",
    "phone_model": "iPhone 14"
  }
  ```

**Денормализованные поля (для индексации и поиска, дублируются из JSON):**
- `country` (строка из ответа на вопрос country)
- `timezone` (определяется автоматически из country)
- `age` (число для фильтрации по возрасту)

> Почему дублирование: PostgreSQL умеет индексировать JSONB, но обычные колонки быстрее для частых фильтров. Дублируем только то, по чему ищем часто.

**Опционально (заполняются позже админом):**
- `birthPlace` (место рождения, может отличаться от страны проживания)
- `englishLevel` (enum: BEGINNER / INTERMEDIATE / ADVANCED / FLUENT)
- `tiktokUsername` (когда создан аккаунт)
- `adminNotes` (свободный текст, может быть длинным)
- `tags` (массив строк, произвольные тэги)

**Системные:**
- `phase` (enum: ENTERED / TASK_COMPLETED / MEET_INVITED / MEET_ATTENDED / MEET_MISSED / STREAMER / ARCHIVED)
- `status` (enum: ACTIVE / PAUSED / REJECTED / GHOSTED)
- `currentLessonNumber` (0 = не учится, 1-12 = на уроке, 13+ = после уроков)
- `assignedManagerId` (uuid, может быть null)
- `assignedAt` (когда менеджер взял)

### 5.2 Поиск и фильтрация

**Команда `/leads`** в боте:

Простой поиск:
```
/leads search аня        — поиск по имени, username, tiktok, заметкам
/leads search +380        — поиск по части телефона
/leads search @username
```

Фильтры (комбинируемые):
```
/leads filter country:poland
/leads filter manager:@stas country:ukraine
/leads filter lesson:3 status:active
/leads filter tag:hot tag:vip
/leads filter source:fb_oct2026 phase:streamer
```

Сортировка:
```
/leads sort created_desc
/leads sort lesson_asc
```

**Реализация:**
- PostgreSQL **trigram-индекс** для нечёткого текстового поиска
- Обычные индексы на `phase`, `status`, `assignedManagerId`, `country`, `tiktokUsername`, `telegramUsername`
- GIN-индекс на `tags[]`
- Фильтры комбинируются через AND
- В выдаче — карточки по 5 штук с пагинацией

### 5.3 Карточка лида (когда админ открыл)

```
👤 Анна Петрова
TG: @anna_petr | Создана: 5 мая 2026

📋 Анкета (динамическая, поля могут меняться)
  Возраст: 22
  Опыт в стримах: Стримила 1+ год
  Страна: Польша (UTC+1)
  Модель телефона: iPhone 14

📊 Статус
  Фаза: STREAMER
  Текущий урок: 3
  Менеджер: @stas (с 10 мая)

📱 Профиль (заполнено админом)
  Место рождения: Львов
  English: Intermediate
  TikTok: @anna_streams

🏷 Тэги: hot, ukrainian, ready

📝 Заметки
  Активная, быстро схватывает. На уроке 3 нужно подтянуть удержание.

[Изменить статус] [Назначить менеджера] [Добавить заметку]
[Перевести в стримера] [Запланировать урок] [История]
```

### 5.4 Динамическая анкета (управление через админку)

Вопросы анкеты — **не в коде**, а в БД. Любой админ может изменить анкету без перезапуска бота:

**Команды:**
```
/survey                          — посмотреть текущую анкету
/survey_add                      — добавить новый вопрос
  → Шаги через диалог:
    1. Ключ (для программного доступа, например "english_level")
    2. Текст вопроса ("Какой у тебя уровень английского?")
    3. Тип ответа: [Число] [Текст] [Выбор] [Множественный выбор] [Да/Нет]
    4. Если "Выбор" — список вариантов
    5. Обязательный? [Да] [Нет]
    6. Валидация (для Числа: min/max)
    7. Порядок (где разместить в анкете)
  
/survey_edit <key>               — изменить вопрос
/survey_remove <key>             — деактивировать (soft delete, ответы сохраняются)
/survey_reorder                  — переставить порядок
```

**Правила:**
- При добавлении нового вопроса — он применяется к **новым лидам**. Старые лиды его не получают
- При удалении вопроса — ответы старых лидов сохраняются в `surveyAnswers` JSON
- Можно создать анкету для конкретного сценария (привязка `scenarioId`) — тогда лиды по этому источнику получают свою анкету
- Если у сценария нет своих вопросов — используется глобальная анкета (`scenarioId = null`)

**Логика обработки невалидных ответов:**
- **NUMBER:** если ввели нечисло или вне диапазона → "Введи число от X до Y" (до 3 попыток, потом пометка для админа в карточке)
- **CHOICE:** невозможен (только inline-кнопки)
- **TEXT:** принимаем всё (валидация только длины)
- **Страна (специальный case):** см. раздел 6

### 5.5 Логика обработки страны (специальный случай)

Страна — критичное поле для определения TZ. Логика:

1. **Кнопки топ-стран** — Украина / Беларусь / Польша / Россия / Другое
2. Если выбрана конкретная — сразу нормализуется и сохраняется `timezone`
3. Если **"Другое"** — бот: "Напиши страну текстом"
4. Лид пишет → бот ищет в БД:
   - **Точный match** по `name` или `nameAliases` (lowercase + trim)
   - Если не нашёл → **fuzzy match** через PostgreSQL `pg_trgm` (similarity > 0.6)
5. Если fuzzy нашёл → "Ты имела в виду **Казахстан**? [Да] [Нет, другое]"
6. Если ничего не найдено или лид сказал "Нет":
   - Сохраняем `country` как введённый текст
   - `timezone = "Europe/Kyiv"` (дефолт)
   - **Карточка флагается** для админа: ⚠️ "Страна не распознана: 'Казакстан'"
   - Админ исправляет → бот добавляет введённое в `nameAliases` (самообучение)

---

## 6. Часовые пояса и нормализация стран

### 6.1 Таблица Country

В БД таблица `Country` с маппингом:
```
Украина → Europe/Kyiv (UTC+2)
Россия → Europe/Moscow (UTC+3)
Беларусь → Europe/Minsk (UTC+3)
Польша → Europe/Warsaw (UTC+1)
Казахстан → Asia/Almaty (UTC+5)
Узбекистан → Asia/Tashkent (UTC+5)
Грузия → Asia/Tbilisi (UTC+4)
Молдова → Europe/Chisinau (UTC+2)
... (15-20 основных стран на старте)
```

Каждая страна имеет:
- `name` — каноническое имя
- `nameAliases` — массив вариантов написания (включая опечатки, английские, локальные)
- `timezone` — IANA timezone
- `flagEmoji` — для красивого отображения

### 6.2 Нормализация при анкете

При ответе на вопрос про страну логика такая:

**Кнопочный путь:**
1. Лид нажал кнопку "🇵🇱 Польша"
2. Сразу сохраняем `country = "Польша"`, `timezone = "Europe/Warsaw"`

**Текстовый путь (после нажатия "Другое"):**
1. Лид написал "Казакстан"
2. Нормализуем: lowercase + trim → "казакстан"
3. **Точный match** по `name` или `nameAliases` всех стран → не найдено
4. **Fuzzy match** через PostgreSQL `pg_trgm`:
   ```sql
   SELECT * FROM "Country"
   WHERE similarity(lower(name), 'казакстан') > 0.6
      OR EXISTS (
        SELECT 1 FROM unnest("nameAliases") alias
        WHERE similarity(lower(alias), 'казакстан') > 0.6
      )
   ORDER BY GREATEST(...) DESC LIMIT 3;
   ```
   → найдено: "Казахстан" с similarity 0.85
5. Бот лиду: "Ты имела в виду **🇰🇿 Казахстан**?" [Да] [Нет, другое]
6. Лид жмёт [Да] → сохраняем `country = "Казахстан"`, `timezone = "Asia/Almaty"`. Бот **автоматически добавляет "казакстан" в nameAliases** для следующих лидов.
7. Лид жмёт [Нет] → бот: "Напиши ещё раз, точнее"

**Если ничего не распознали даже после 2-3 попыток:**
- Сохраняем строку как есть
- `timezone = "Europe/Kyiv"` (дефолт)
- В карточке появляется флаг ⚠️ "Уточни страну/TZ"
- Админ исправляет → бот учится

### 6.3 Использование TZ во всех напоминаниях

Все напоминания пересчитываются в TZ лида:
- Интро-кал в 14:00 по Киеву + лид в UTC+1 → бот шлёт "Через 15 минут созвон!" в **13:45 по Варшаве**
- В тексте напоминания указываем оба времени: "Сегодня в 14:00 по Киеву (13:00 у тебя)"

Реализация через `date-fns-tz` или Luxon.

---

## 7. Интро-калы

### 7.1 Создание

Админ в боте:
```
/introcall_new
→ Дата: 15 мая 2026
→ Время: 14:00 Киев
→ Meet URL: https://meet.google.com/abc-xyz-123
→ Описание: "Знакомство, обзор работы"
```

Создаётся `IntroCall` с этими данными.

### 7.2 Приглашение лидов

Админ открывает карточку лида → "Добавить на интро" → выбирает ближайший созвон.

ИЛИ массово: `/introcall_invite <id> filter:phase:task_completed`.

Создаётся `MeetInvite` для каждого приглашённого лида (с уникальным tracking-токеном).

### 7.3 Напоминания

Бот сам шлёт лиду:
- **T-1 день в 18:00** в TZ лида: "Завтра в [время в TZ лида] (по Киеву [время по Киеву]) у нас знакомство. Подготовься."
- **T-15 минут** в TZ лида: "Через 15 минут начинаем! Жми по ссылке: [tracking link]"
- **T-5 минут**, если **не кликнул** ни разу: "Не забудь, через 5 минут начинаем! [ссылка]"

Никаких сообщений менеджеру/админу. Только лиду.

### 7.4 Tracking

Клик по tracking-ссылке:
- На фазе A разработки: через Telegram deep link `t.me/bot?start=meet_TOKEN`
- На фазе B+: через HTTP-роут `https://domain/m/:token` → редирект на Meet

В обоих случаях фиксируется `MeetInvite.clickedAt`.

После созвона админ вручную отмечает в карточке лида:
- ✅ Пришёл
- ❌ Не пришёл
- ⏸ Опоздал

---

## 8. Перевод LEAD → STREAMER

После интро-кала и создания TikTok-аккаунта:

1. Админ открывает карточку лида
2. Нажимает "Перевести в стримера"
3. Бот спрашивает: "TikTok username?" → "Менеджер?" → "Подтвердить?"
4. Изменения:
   - `phase = STREAMER`
   - `currentLessonNumber = 0` (ещё не на уроке)
   - `tiktokUsername = <введённое>`
   - `assignedManagerId = <выбранный>`
   - `assignedAt = now()`
5. Бот пишет стримеру: "Добро пожаловать в обучение! Твой менеджер — @stas, он скоро с тобой свяжется"

**Никаких автоматических созданий профилей стримеров отдельной таблицей** — всё в `LeadProfile`. Это упрощение. Когда понадобится больше полей для стримера (финансы, история уроков и т.д.) — добавим таблицу `StreamerData` через 1:1 связь.

---

## 9. Уроки и расписание

### 9.1 Справочник уроков (контент)

В БД 12 уроков с твоим контентом:

```
Stage 1. Знакомство и старт
  Lesson 1: Введение и базовые знания (видео до 10 мин)
  Lesson 2: Съёмка видео для прогрева (видео до 15 мин)
  Lesson 3: Тех. часть, блок 1 (платформа, Binance, PayPal)

Stage 2. Первые эфиры
  Lesson 4: Первый эфир (short call)
  Lesson 5: Анализ + 2-й эфир (текст с советами)
  Lesson 6: Второй выход в эфир
  Lesson 7: Батлы (теория + разбор)

Stage 3. Развитие (2-3 неделя)
  Lesson 8: Тех. часть, блок 2 (TikTok Studio, лиги, баланс)
  Lesson 9: Дарители (теория, переписка, удержание)
  Lesson 10: Виды манипуляций дарителями + психотипы
  Lesson 11: Чатинг
  Lesson 12: Работа с эмоциями

Stage 4. Углубление (после 12 урока, периодически)
  Lesson 13: Договорные батлы + геймификация
  Lesson 14: Оформление профиля
  Lesson 15: Английский язык (рекуррентный, раз в неделю)
```

**Все материалы (тексты, фото, видео-ссылки) хранятся в БД** и редактируются через бот. На старте может быть пусто — наполняешь по мере создания контента.

### 9.2 Расписание (модель В — простая)

**Сценарий ежедневной работы менеджера:**

1. **На уроке** менеджер устно договаривается с стримером о следующем уроке
2. После урока менеджер в боте:
   ```
   /lesson_completed <streamer>
   → Какой урок прошли? [Lesson 1]
   → Когда следующий? [завтра, 15:00 по Киеву]
   → Заметка по уроку: "хорошо схватила, нужно подтянуть энергию"
   ```
3. Бот сохраняет:
   - `LessonInstance` (status=COMPLETED) для проведённого урока
   - `LessonInstance` (status=SCHEDULED) для следующего урока
   - Шлёт стримеру (в его TZ) напоминания: T-24h, T-1h, T-15min
   - Шлёт менеджеру: T-1h ("Через час урок с Аней + ссылка на материалы Lesson 2")

### 9.3 Напоминания менеджеру

За час до урока бот шлёт менеджеру:
```
⏰ Через час урок с @anna_petr (Lesson 2)
📍 Discord канал #lessons-stas
📚 Материалы урока: [текст / фото / ссылки на видео]
📝 Прошлая заметка: "хорошо схватила, нужно подтянуть энергию"
```

Материалы прикладываются прямо в сообщение, чтобы менеджер мог быстро освежить.

### 9.4 Английский (рекуррентный)

В БД сущность `RecurringLesson`:
```
title: "Английский"
teacherId: <uuid отдельного человека>
dayOfWeek: WEDNESDAY
time: 18:00 (по Киеву)
duration: 60 минут
channel: "Discord #english"
```

Бот раз в неделю автоматически:
- В понедельник утром шлёт **всем активным стримерам** (currentLesson ≥ 1) **в их TZ**: "В среду в [время по их TZ] урок английского с [имя]. Заходи в Discord #english"
- В среду T-1h: повторное напоминание
- В среду T-15min: финальное напоминание

**Английский считается отдельной сущностью**, не идёт в счётчик `currentLessonNumber`.

---

## 10. Управление командой (минимум на старте)

### 10.1 Роль

На старте **единственная роль `ADMIN`** для всех сотрудников MIMI.

Все админы могут:
- Видеть всех лидов/стримеров
- Менять статусы, заметки, тэги
- Создавать интро-калы
- Переводить лидов в стримеров
- Планировать уроки (с любым стримером)
- Менять контент бота (приветствие, кружки, тексты)

### 10.2 Назначение менеджера на стримера

Когда лид становится стримером, ему присваивается `assignedManagerId`. Это **не блокирует** других админов смотреть его карточку — только показывает "ответственный за обучение".

### 10.3 Команды

```
/team — список админов
/team_add <telegram_id> — добавить нового админа
/team_remove <telegram_id> — убрать админа
```

Первый владелец задаётся через `.env` `INITIAL_ADMIN_TELEGRAM_ID=<id>`.

### 10.4 Будущая иерархия

В схеме поле `User.role` enum уже включает: `ADMIN`, `OWNER`, `HR`, `MANAGER`, `STREAMER`. На старте все = `ADMIN`. Когда понадобится разграничение прав — меняем роли в БД (это **миграция данных**, не схемы) и активируем middleware-проверки.

---

## 11. Схема БД (Prisma) — финальная

> Минимум для MVP + заделы под будущее. Таблицы с пометкой `[FUTURE]` создаются с самого начала, но в MVP не используются — это страховка от миграций.

```prisma
// ========== CORE ==========

model User {
  id              String   @id @default(uuid())
  telegramUserId  BigInt   @unique
  telegramUsername String?
  firstName       String?
  lastName        String?
  
  role            Role     @default(LEAD)
  
  // Pre-emptive для будущего
  discordUserId   String?  @unique
  
  // Soft delete
  deletedAt       DateTime?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Profile (1:1)
  leadProfile     LeadProfile?
  
  // As admin/manager
  assignedLeads   LeadProfile[]    @relation("AssignedManager")
  taughtLessons   LessonInstance[] @relation("Teacher")
  
  @@index([telegramUsername])
}

enum Role {
  LEAD          // default для всех новых пользователей
  ADMIN         // используется в MVP для всей команды MIMI
  OWNER         // [FUTURE]
  HR            // [FUTURE]
  MANAGER       // [FUTURE]
  STREAMER      // [FUTURE]
}

// ========== LEAD / STREAMER PROFILE ==========

model LeadProfile {
  id              String   @id @default(uuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id])
  
  // Source tracking
  sourceCode      String?
  
  // Survey: динамические ответы (структура зависит от текущей анкеты)
  surveyAnswers   Json     @default("{}")
  
  // Денормализация для индексации/поиска (дублируется из surveyAnswers)
  age             Int?
  country         String?
  timezone        String   @default("Europe/Kyiv")
  
  // Флаг для админа: страна не распозналась автоматически
  countryNeedsReview Boolean @default(false)
  
  // Optional fields (заполняются админом отдельно от анкеты)
  birthPlace      String?
  englishLevel    EnglishLevel?
  tiktokUsername  String?  @unique
  adminNotes      String?  @db.Text
  
  tags            String[] @default([])
  
  // Funnel state
  phase           LeadPhase  @default(ENTERED)
  status          LeadStatus @default(ACTIVE)
  
  // Streamer fields (заполняются после конверсии)
  currentLessonNumber Int  @default(0)
  promotedToStreamerAt DateTime?
  
  // Manager
  assignedManagerId String?
  assignedManager User?    @relation("AssignedManager", fields: [assignedManagerId], references: [id])
  assignedAt      DateTime?
  
  // Current funnel position
  currentScenarioId String?
  currentScenarioStepId String?
  currentSurveyQuestionId String?              // на каком вопросе сейчас находится
  
  // Meet
  meetInvites     MeetInvite[]
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Indexes for fast search
  @@index([phase])
  @@index([status])
  @@index([country])
  @@index([assignedManagerId])
  @@index([currentLessonNumber])
  @@index([sourceCode])
  @@index([tags], type: Gin)
  @@index([surveyAnswers], type: Gin)            // GIN для JSONB-поиска по любым полям анкеты
}

enum EnglishLevel { BEGINNER INTERMEDIATE ADVANCED FLUENT }

enum LeadPhase {
  ENTERED              // только что зашёл
  TASK_COMPLETED       // прошёл анкету
  MEET_INVITED         // приглашён на интро-кал
  MEET_ATTENDED        // пришёл на интро
  MEET_MISSED          // не пришёл
  STREAMER             // переведён в стримера
}

enum LeadStatus {
  ACTIVE
  PAUSED
  REJECTED
  GHOSTED
  ARCHIVED
}

// ========== COUNTRY / TIMEZONE ==========

model Country {
  id              String   @id @default(uuid())
  name            String   @unique           // "Польша"
  nameAliases     String[]                   // ["polska", "poland", "polsha", "пл"]
  isoCode         String   @unique           // "PL"
  timezone        String                     // "Europe/Warsaw"
  flagEmoji       String?                    // "🇵🇱"
  isTopCountry    Boolean  @default(false)   // показывать ли в кнопочном списке
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([nameAliases], type: Gin)
}

// ========== SURVEY (динамическая анкета) ==========

model SurveyQuestion {
  id              String   @id @default(uuid())
  scenarioId      String?                       // null = глобальная, или конкретный сценарий
  scenario        Scenario? @relation(fields: [scenarioId], references: [id])
  
  key             String                        // "age", "tt_experience" — для surveyAnswers JSON
  question        String                        // "Сколько тебе лет?"
  hint            String?                       // подсказка под вопросом
  type            QuestionType
  options         Json?                         // для CHOICE: [{ label: "Стримила 1+ год", value: "1plus_year" }]
  validation      Json?                         // { min: 16, max: 60 } для NUMBER
  
  isRequired      Boolean  @default(true)
  isActive        Boolean  @default(true)
  order           Int
  
  // Специальная логика
  isCountryQuestion Boolean @default(false)     // если true — применяется логика страны (кнопки топ + fuzzy)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@unique([scenarioId, key])
  @@index([scenarioId, order])
}

enum QuestionType {
  NUMBER          // число с min/max
  TEXT            // свободный текст
  CHOICE          // одиночный выбор из options
  MULTI_CHOICE    // множественный выбор
  BOOLEAN         // да/нет
}

// ========== SCENARIOS (CMS воронки) ==========

model Scenario {
  id              String   @id @default(uuid())
  sourceCode      String   @unique
  name            String
  description     String?
  isActive        Boolean  @default(true)
  isDefault       Boolean  @default(false)
  
  steps           Step[]
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Step {
  id              String   @id @default(uuid())
  scenarioId      String
  scenario        Scenario @relation(fields: [scenarioId], references: [id])
  order           Int
  type            StepType
  content         Json
  mediaAssetId    String?
  mediaAsset      MediaAsset? @relation(fields: [mediaAssetId], references: [id])
  nextStepId      String?
  delayAfterSeconds Int    @default(0)
  
  @@unique([scenarioId, order])
}

enum StepType {
  TEXT
  PHOTO
  VIDEO_NOTE
  VOICE
  BUTTONS
  DELAY
  SURVEY
}

model MediaAsset {
  id              String   @id @default(uuid())
  type            MediaAssetType
  telegramFileId  String
  description     String                       // "Кружок-приветствие от Маши"
  uploadedByUserId String?
  isActive        Boolean  @default(true)
  
  steps           Step[]
  
  createdAt       DateTime @default(now())
}

enum MediaAssetType {
  VIDEO_NOTE
  PHOTO
  VOICE
  VIDEO
  DOCUMENT
}

// ========== INTRO CALLS ==========

model IntroCall {
  id              String   @id @default(uuid())
  scheduledAt     DateTime
  meetUrl         String
  description     String?
  status          IntroCallStatus @default(SCHEDULED)
  
  invites         MeetInvite[]
  
  createdAt       DateTime @default(now())
}

enum IntroCallStatus { SCHEDULED ONGOING COMPLETED CANCELLED }

model MeetInvite {
  id              String   @id @default(uuid())
  token           String   @unique
  introCallId     String
  introCall       IntroCall @relation(fields: [introCallId], references: [id])
  leadProfileId   String
  leadProfile     LeadProfile @relation(fields: [leadProfileId], references: [id])
  
  // Reminders state
  reminder1DaySentAt DateTime?
  reminder15MinSentAt DateTime?
  reminder5MinSentAt DateTime?
  
  // Tracking
  clickedAt       DateTime?
  
  // Attendance (заполняет админ)
  attended        Boolean?
  
  createdAt       DateTime @default(now())
}

// ========== LESSONS ==========

model Lesson {
  id              String   @id @default(uuid())
  number          Int      @unique           // 1-12 + 13+, или 0 для рекуррентных
  stage           Int                          // 1-4
  title           String
  description     String?  @db.Text
  
  // Content
  videoUrl        String?
  textContent     String?  @db.Text          // markdown
  materialsJson   Json?                       // фото/ссылки/допматериалы
  
  // Recurring (для английского)
  isRecurring     Boolean  @default(false)
  recurringDayOfWeek Int?                     // 0-6
  recurringTime   String?                     // "18:00"
  recurringChannel String?                    // "Discord #english"
  recurringTeacherId String?
  
  isActive        Boolean  @default(true)
  
  instances       LessonInstance[]
}

model LessonInstance {
  id              String   @id @default(uuid())
  lessonId        String
  lesson          Lesson   @relation(fields: [lessonId], references: [id])
  teacherId       String
  teacher         User     @relation("Teacher", fields: [teacherId], references: [id])
  
  scheduledAt     DateTime
  status          LessonInstanceStatus @default(SCHEDULED)
  
  channelInfo     String?                     // "Discord #lessons-stas"
  
  managerNotes    String?  @db.Text          // заметка после урока
  
  // Reminders state
  reminder24hSentAt DateTime?
  reminder1hSentAt DateTime?
  reminder15minSentAt DateTime?
  
  participants    LessonParticipation[]
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum LessonInstanceStatus { SCHEDULED IN_PROGRESS COMPLETED CANCELLED MISSED }

model LessonParticipation {
  id              String   @id @default(uuid())
  lessonInstanceId String
  lessonInstance  LessonInstance @relation(fields: [lessonInstanceId], references: [id])
  leadProfileId   String
  
  attended        Boolean?
  
  @@unique([lessonInstanceId, leadProfileId])
}

// ========== INFRASTRUCTURE ==========

model AuditLog {
  id              String   @id @default(uuid())
  userId          String?
  action          String                       // "lead_promoted", "scenario_updated"
  entityType      String?
  entityId        String?
  diff            Json?
  createdAt       DateTime @default(now())
}

model FeatureFlag {
  id              String   @id @default(uuid())
  key             String   @unique
  enabled         Boolean  @default(false)
  description     String?
  updatedAt       DateTime @updatedAt
}

// ========== [FUTURE] Заделы под будущее ==========

// На MVP не используются, но место в БД заложено:

model HomeworkAssignment {                    // [FUTURE]
  id              String   @id @default(uuid())
  leadProfileId   String
  assignedById    String
  title           String
  description     String   @db.Text
  deadlineAt      DateTime
  status          String   @default("ASSIGNED")
  createdAt       DateTime @default(now())
}

model StreamReview {                          // [FUTURE]
  id              String   @id @default(uuid())
  leadProfileId   String
  managerId       String
  streamDate      DateTime @db.Date
  metrics         Json
  comments        String   @db.Text
  createdAt       DateTime @default(now())
}

model Revenue {                               // [FUTURE]
  id              String   @id @default(uuid())
  leadProfileId   String
  weekStart       DateTime @db.Date
  weekEnd         DateTime @db.Date
  grossIncomeUsd  Decimal  @db.Decimal(10, 2)
  status          String   @default("PENDING")
  notes           String?
  createdAt       DateTime @default(now())
}
```

---

## 12. Структура репозитория

```
mimi-bot/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                  # начальный админ + 12 уроков + страны
│
├── src/
│   ├── index.ts
│   ├── server.ts                # Fastify + polling
│   │
│   ├── config/
│   │   └── env.ts
│   │
│   ├── core/
│   │   ├── db.ts
│   │   ├── redis.ts
│   │   ├── queue.ts             # BullMQ
│   │   ├── events.ts            # EventEmitter
│   │   └── logger.ts
│   │
│   ├── bot/
│   │   ├── index.ts             # grammY setup
│   │   ├── middlewares/
│   │   │   ├── user.ts          # find/create User
│   │   │   ├── admin.ts         # role check
│   │   │   └── logger.ts
│   │   └── handlers/
│   │       ├── start.ts         # /start + deep link
│   │       ├── lead/            # для лидов в воронке
│   │       │   ├── survey.ts
│   │       │   └── steps.ts
│   │       └── admin/
│   │           ├── leads.ts     # /leads search/filter
│   │           ├── card.ts      # карточка лида
│   │           ├── scenarios.ts # CMS воронки
│   │           ├── survey.ts    # /survey, /survey_add, /survey_edit
│   │           ├── countries.ts # /countries — управление странами
│   │           ├── media.ts     # загрузка кружков
│   │           ├── introcalls.ts
│   │           ├── lessons.ts   # планирование уроков
│   │           ├── team.ts
│   │           └── promote.ts   # LEAD → STREAMER
│   │
│   ├── modules/
│   │   ├── funnel/
│   │   │   ├── engine.ts        # движок воронки
│   │   │   └── repository.ts
│   │   ├── survey/
│   │   │   ├── engine.ts        # обработка ответов на динамические вопросы
│   │   │   ├── validator.ts     # валидация по типам
│   │   │   └── repository.ts
│   │   ├── leads/
│   │   │   ├── search.ts        # поиск + фильтры
│   │   │   └── service.ts
│   │   ├── timezones/
│   │   │   ├── resolver.ts      # country → timezone
│   │   │   ├── fuzzy.ts         # fuzzy matching стран
│   │   │   └── countries.seed.ts
│   │   ├── introcalls/
│   │   │   ├── service.ts
│   │   │   └── reminders.ts     # BullMQ jobs
│   │   ├── lessons/
│   │   │   ├── service.ts
│   │   │   ├── reminders.ts
│   │   │   └── recurring.ts     # английский по средам
│   │   ├── scenarios/
│   │   ├── media/
│   │   └── audit/
│   │
│   ├── routes/
│   │   ├── meet.ts              # GET /m/:token (фаза B+)
│   │   └── health.ts
│   │
│   └── shared/
│       ├── types.ts
│       └── utils.ts
│
└── scripts/
    ├── seed-countries.ts        # справочник стран с nameAliases
    ├── seed-survey.ts           # дефолтная анкета (4 вопроса)
    ├── seed-lessons.ts          # 12 уроков с контентом
    └── set-admin.ts             # назначение админа
```

---

## 13. Roadmap MVP (1 неделя + 1 неделя стабилизация)

### Неделя 1 — Костяк

**День 1-2:** Setup
- [ ] Init repo, package.json, tsconfig, Docker Compose
- [ ] Prisma schema (полная из раздела 11), миграция
- [ ] Seed: 12 уроков + список стран + первый ADMIN
- [ ] Fastify server, polling-режим бота
- [ ] Базовый /start с deep link

**День 3-4:** Воронка + Динамическая анкета
- [ ] Funnel engine (читает шаги из БД)
- [ ] Step types: TEXT, VIDEO_NOTE, BUTTONS, DELAY
- [ ] **SurveyQuestion модель + динамическая анкета** (управляется через /survey, /survey_add, /survey_edit)
- [ ] Сохранение ответов в `LeadProfile.surveyAnswers` JSON
- [ ] Денормализация в колонки: age, country, timezone
- [ ] Валидация ответов (NUMBER min/max, CHOICE из options)
- [ ] **Country resolver:** seed 15-20 стран с aliases и flag emoji
- [ ] **Fuzzy matching стран** через `pg_trgm`: при опечатке "Казакстан" → "Ты имела в виду Казахстан?"
- [ ] Самообучение: при подтверждении пользователем — добавление в aliases
- [ ] Флаг `countryNeedsReview` для админа если не распознали
- [ ] CMS-команды: `/scenarios`, `/scenario_edit`, `/upload_media`

**День 5-7:** База лидов
- [ ] `/leads` команда с поиском
- [ ] Фильтры по полям + тэги
- [ ] Карточка лида с inline-кнопками
- [ ] Edit заметок, тэгов, опциональных полей
- [ ] Перевод LEAD → STREAMER

### Неделя 2 — Интро и уроки

**День 8-10:** Интро-калы
- [ ] IntroCall CRUD
- [ ] Массовое приглашение лидов на интро
- [ ] Tracking-ссылки (deep link фаза A)
- [ ] Напоминания T-1d, T-15min, T-5min с TZ-конвертацией

**День 11-14:** Уроки
- [ ] LessonInstance CRUD
- [ ] `/lesson_completed` flow + создание следующего урока
- [ ] Напоминания стримеру (24h, 1h, 15min) в его TZ
- [ ] Напоминания менеджеру (1h) с материалами
- [ ] Английский: рекуррентная отправка по средам

### Стабилизация (неделя 3+)
- [ ] Реальный тест на 5-10 живых лидах
- [ ] Фиксы UX
- [ ] Деплой на Oracle Cloud Free Tier

---

## 14. Что НЕ делаем на старте

1. ❌ Финансовый модуль (Revenue, Payout, ManagerCommission) — заложен в БД, но не используется
2. ❌ Stream reviews — таблица есть, кода нет
3. ❌ Homework system — таблица есть, кода нет
4. ❌ Materials с unlock-логикой — лишнее, материалы открываются всегда
5. ❌ Discord-интеграция через API — только текстом "заходи в канал"
6. ❌ Google Calendar — бот сам хранит расписание
7. ❌ Множественные роли — все ADMIN
8. ❌ Follow-up автоматический (24h, 72h, GHOSTED) — пока не нужно
9. ❌ Алерты владельцу (escalations) — пока не нужно
10. ❌ Аналитика воронки (CR по фазам) — добавим когда будет статистика
11. ❌ Outbox pattern — пока обычная отправка (если упадёт — некритично на старте)
12. ❌ A/B тесты сценариев

---

# ЧАСТЬ Б. ПРОМТ ДЛЯ CLAUDE CODE

> Скопировать как первое сообщение в Claude Code.

---

## Промт

Ты — senior full-stack TypeScript-инженер. Помогаешь мне построить **MIMI Agency Bot** — Telegram-бот для TikTok-агентства.

### Контекст

Полная спецификация — в файле `MIMI_BOT_PRD_v3.md` в корне репозитория. Прочти его целиком перед написанием кода. На любой вопрос отвечай со ссылкой на конкретный раздел PRD.

### Главные принципы

1. **Это MVP. Делай минимум.** Не добавляй фичи, которых нет в PRD.
2. **Карточка лида — главная сущность.** База с гибким поиском — приоритет №1.
3. **Контент в БД, не в коде.** Все тексты, кружки, материалы редактируются через бот.
4. **Один сценарий по умолчанию.** Но архитектура должна поддерживать несколько.
5. **Один тип роли — ADMIN.** Не реализуй разделение прав. Поле `role` в БД есть, но в коде все админы равны.
6. **Polling-режим бота.** Не webhook.
7. **Не делай то, что в разделе 14 "Что НЕ делаем".** Соблазн будет — игнорируй.
8. **Полная типобезопасность.** Никаких `any`, валидация input через zod.
9. **Все долгие задачи через BullMQ.** Никаких setTimeout.
10. **Заложенные в БД таблицы для будущего (HomeworkAssignment, StreamReview, Revenue) — НЕ ТРОГАЙ.** Они существуют только в schema.prisma, никакого кода под них.

### План работы (по дням, согласно разделу 13)

День 1-2: setup + schema + seed + polling
День 3-4: воронка + CMS
День 5-7: база лидов с поиском
День 8-10: интро-калы
День 11-14: уроки

Каждый день = 1-3 файла. После каждого дня — мини-README.

### Правила взаимодействия

- В начале каждого файла — комментарий "что делает + зависимости"
- В сложной логике — комментарии на русском с **причиной** ("почему так")
- Неоднозначность в PRD — **спрашивай**, не угадывай
- Отклонение от PRD — явно скажи: "Предлагаю изменить раздел X, потому что..."

### Стартовая команда

Покажи мне план для дня 1: какие файлы создашь, что в каждом будет, какие npm-пакеты установишь, как запустить через docker-compose. После моего ОК — генерируй файлы.

---

**Конец промта.**

---

## 15. Открытые вопросы (на потом)

- Импорт ~340 старых лидов из существующей базы (формат? Когда?)
- Финансовый модуль
- Discord API интеграция
- Google Calendar
- Web-админка
- Расширение ролей (когда команда вырастет до 20+)
- Этапы 2-4 из старого PRD v2 (см. для справки)

