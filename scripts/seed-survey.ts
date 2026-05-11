/**
 * Дефолтная анкета (PRD §4): 4 вопроса, scenarioId=null (глобальные).
 * Зависимости: @prisma/client.
 *
 * Идемпотентный сид: на каждом запуске удаляем все глобальные вопросы и
 * создаём их заново. Это безопасно: ответы лидов в LeadProfile.surveyAnswers
 * хранятся в JSON по строковому ключу вопроса и НЕ ссылаются на SurveyQuestion.id.
 *
 * Так избегаем проблемы Postgres с NULL в unique-индексе (NULL != NULL),
 * из-за которой prisma.upsert на (scenarioId=null, key) не работает.
 *
 * Менять анкету в проде нужно через бот-команды /survey_edit, /survey_add
 * (придут в дне 3-4), не через повторный запуск сидов.
 */
import type { PrismaClient } from '@prisma/client';

type SurveyQuestionSeed = {
  key: string;
  question: string;
  hint?: string;
  type: 'NUMBER' | 'TEXT' | 'CHOICE' | 'MULTI_CHOICE' | 'BOOLEAN';
  options?: Array<{ label: string; value: string }>;
  validation?: Record<string, unknown>;
  order: number;
  isCountryQuestion?: boolean;
};

const QUESTIONS: SurveyQuestionSeed[] = [
  {
    key: 'age',
    question: '🎂 Сколько тебе лет?',
    type: 'NUMBER',
    validation: { min: 16, max: 60 },
    order: 1,
  },
  {
    key: 'tt_experience',
    question: '📺 Какой у тебя опыт в TikTok-стримах?',
    type: 'CHOICE',
    options: [
      { label: 'Стримила 1+ год', value: '1plus_year' },
      { label: 'Пробовала пару раз', value: 'few_times' },
      { label: 'Никогда', value: 'never' },
    ],
    order: 2,
  },
  {
    key: 'country',
    question: '🌍 Из какой ты страны?',
    type: 'CHOICE',
    isCountryQuestion: true,
    // Опции игнорируются движком, если isCountryQuestion=true:
    // там кнопки top-стран из Country + текстовый fallback "Другое" (PRD §5.5).
    order: 3,
  },
  {
    key: 'phone_model',
    question: '📱 На каком телефоне снимаешь?',
    hint: 'Рекомендуем iPhone 13+ или флагман Android. Если другая модель — тоже напиши.',
    type: 'TEXT',
    validation: { maxLength: 100 },
    order: 4,
  },
];

export async function seedSurvey(prisma: PrismaClient): Promise<number> {
  await prisma.surveyQuestion.deleteMany({ where: { scenarioId: null } });
  await prisma.surveyQuestion.createMany({
    data: QUESTIONS.map((q) => ({
      scenarioId: null,
      key: q.key,
      question: q.question,
      hint: q.hint,
      type: q.type,
      options: q.options ?? undefined,
      validation: q.validation ?? undefined,
      order: q.order,
      isCountryQuestion: q.isCountryQuestion ?? false,
    })),
  });
  return QUESTIONS.length;
}
