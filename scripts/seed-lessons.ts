/**
 * 12 базовых уроков MIMI + 13-14 (углубление) + 15 (английский recurring).
 * Контент (PRD §9.1) на старте пустой — наполняется через бот-команды позже.
 * Зависимости: @prisma/client.
 *
 * Lesson.id = номер урока (Int) — так удобно: "Lesson 3" → id=3.
 * Английский: isRecurring=true, dayOfWeek=3 (Wednesday по JS Date.getDay()).
 */
import type { PrismaClient } from '@prisma/client';

type LessonSeed = {
  id: number;
  stage: number;
  title: string;
  description?: string;
  isRecurring?: boolean;
  recurringDayOfWeek?: number;
  recurringTime?: string;
  recurringChannel?: string;
};

const LESSONS: LessonSeed[] = [
  // Stage 1. Знакомство и старт
  { id: 1, stage: 1, title: 'Введение и базовые знания', description: 'Видео до 10 мин' },
  { id: 2, stage: 1, title: 'Съёмка видео для прогрева', description: 'Видео до 15 мин' },
  { id: 3, stage: 1, title: 'Тех. часть, блок 1', description: 'Платформа, Binance, PayPal' },
  // Stage 2. Первые эфиры
  { id: 4, stage: 2, title: 'Первый эфир', description: 'Short call' },
  { id: 5, stage: 2, title: 'Анализ + 2-й эфир', description: 'Текст с советами' },
  { id: 6, stage: 2, title: 'Второй выход в эфир' },
  { id: 7, stage: 2, title: 'Батлы', description: 'Теория + разбор' },
  // Stage 3. Развитие
  { id: 8, stage: 3, title: 'Тех. часть, блок 2', description: 'TikTok Studio, лиги, баланс' },
  { id: 9, stage: 3, title: 'Дарители', description: 'Теория, переписка, удержание' },
  { id: 10, stage: 3, title: 'Виды манипуляций дарителями + психотипы' },
  { id: 11, stage: 3, title: 'Чатинг' },
  { id: 12, stage: 3, title: 'Работа с эмоциями' },
  // Stage 4. Углубление (после 12 урока, периодически)
  { id: 13, stage: 4, title: 'Договорные батлы + геймификация' },
  { id: 14, stage: 4, title: 'Оформление профиля' },
  // Английский — рекуррентный, в счётчик currentLessonNumber не идёт (PRD §9.4)
  {
    id: 15,
    stage: 4,
    title: 'Английский',
    description: 'Раз в неделю, среда 18:00 по Киеву',
    isRecurring: true,
    recurringDayOfWeek: 3,
    recurringTime: '18:00',
    recurringChannel: 'Discord #english',
  },
];

export async function seedLessons(prisma: PrismaClient): Promise<number> {
  for (const l of LESSONS) {
    await prisma.lesson.upsert({
      where: { id: l.id },
      update: {
        stage: l.stage,
        title: l.title,
        description: l.description ?? null,
        isRecurring: l.isRecurring ?? false,
        recurringDayOfWeek: l.recurringDayOfWeek ?? null,
        recurringTime: l.recurringTime ?? null,
        recurringChannel: l.recurringChannel ?? null,
      },
      create: {
        id: l.id,
        stage: l.stage,
        title: l.title,
        description: l.description,
        isRecurring: l.isRecurring ?? false,
        recurringDayOfWeek: l.recurringDayOfWeek,
        recurringTime: l.recurringTime,
        recurringChannel: l.recurringChannel,
      },
    });
  }
  return LESSONS.length;
}
