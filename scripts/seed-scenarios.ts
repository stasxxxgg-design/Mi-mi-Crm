/**
 * Дефолтный сценарий: 2 текстовых приветствия + маркер запуска анкеты.
 * Зависимости: @prisma/client.
 *
 * Принцип PRD §2: "Один сценарий по умолчанию + гибкость под несколько".
 * Этот сценарий проигрывается лидам, которые пришли без deep link или с
 * неизвестным sourceCode. Кастомные сценарии для конкретных рекламных
 * кампаний админ создаст через бот в дне 4.
 *
 * StepType.SURVEY — маркер "теперь запускай анкету" (PRD §11 + согласование
 * с пользователем A1: используем существующий enum-вариант, не добавляем
 * SURVEY_START).
 *
 * delayAfterSeconds=0 везде на день 3: полноценный delay-runner с BullMQ
 * придёт в дне 4. До тех пор шаги проигрываются подряд.
 *
 * Сид идемпотентный: удаляет старые Step'ы и создаёт заново. Сценарий
 * upsert'ится по sourceCode='default'.
 */
import type { PrismaClient } from '@prisma/client';

const DEFAULT_SOURCE_CODE = 'default';

type StepSeed =
  | { type: 'TEXT'; order: number; content: { text: string; parseMode?: 'HTML' } }
  | { type: 'SURVEY'; order: number };

const STEPS: StepSeed[] = [
  {
    type: 'TEXT',
    order: 1,
    content: {
      text:
        'Привет! Я бот агентства <b>MIMI</b>. ' +
        'Помогу тебе пройти знакомство и записаться на интро-кал с менеджером.',
      parseMode: 'HTML',
    },
  },
  {
    type: 'TEXT',
    order: 2,
    content: {
      text:
        'Сейчас задам пару вопросов — это поможет нам подобрать формат работы. ' +
        'Если что-то непонятно или хочешь пропустить — просто напиши, что не подходит.',
      parseMode: 'HTML',
    },
  },
  {
    type: 'SURVEY',
    order: 3,
  },
];

export async function seedDefaultScenario(prisma: PrismaClient): Promise<number> {
  const scenario = await prisma.scenario.upsert({
    where: { sourceCode: DEFAULT_SOURCE_CODE },
    update: {
      name: 'Default',
      description: 'Базовый сценарий: welcome + анкета (PRD §4)',
      isActive: true,
      isDefault: true,
    },
    create: {
      sourceCode: DEFAULT_SOURCE_CODE,
      name: 'Default',
      description: 'Базовый сценарий: welcome + анкета (PRD §4)',
      isActive: true,
      isDefault: true,
    },
  });

  // Пересоздаём шаги: вернуть их к каноническому набору. Лиды в момент
  // прохождения держат ссылку на конкретный Step.id через
  // LeadProfile.currentScenarioStepId, но на день 3 настоящего step-runner
  // ещё нет — шаги проигрываются in-memory из start handler.
  await prisma.step.deleteMany({ where: { scenarioId: scenario.id } });
  for (const s of STEPS) {
    await prisma.step.create({
      data: {
        scenarioId: scenario.id,
        order: s.order,
        type: s.type,
        content: 'content' in s ? s.content : {},
      },
    });
  }

  return STEPS.length;
}
