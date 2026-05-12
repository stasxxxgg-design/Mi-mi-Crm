/**
 * Доступ к SurveyQuestion и обновлению LeadProfile.surveyAnswers / стейта.
 * Зависимости: @prisma/client.
 *
 * На день 3 работаем только с глобальной анкетой (scenarioId=null). Когда
 * подключим scenario-specific вопросы (день 4 CMS), сюда уйдёт scenarioId
 * параметр или отдельные функции.
 *
 * surveyAnswers — JSONB-объект { [questionKey]: answer }. Тут же временно
 * живут служебные ключи с префиксом `_` (например `_countryFlow` для стейта
 * country-flow). Они исключаются из видимой анкеты в админке.
 */
import type { Prisma, PrismaClient, SurveyQuestion } from '@prisma/client';

export function listActiveGlobalQuestions(prisma: PrismaClient): Promise<SurveyQuestion[]> {
  return prisma.surveyQuestion.findMany({
    where: { scenarioId: null, isActive: true },
    orderBy: { order: 'asc' },
  });
}

/**
 * Все глобальные вопросы — включая isActive=false (для админки /survey).
 * Сортируем active'ные по order ASC, archived прицепляем после.
 */
export function listAllGlobalQuestions(prisma: PrismaClient): Promise<SurveyQuestion[]> {
  return prisma.surveyQuestion.findMany({
    where: { scenarioId: null },
    orderBy: [{ isActive: 'desc' }, { order: 'asc' }],
  });
}

export function getQuestionById(prisma: PrismaClient, id: string): Promise<SurveyQuestion | null> {
  return prisma.surveyQuestion.findUnique({ where: { id } });
}

export async function getFirstActiveQuestion(prisma: PrismaClient): Promise<SurveyQuestion | null> {
  return prisma.surveyQuestion.findFirst({
    where: { scenarioId: null, isActive: true },
    orderBy: { order: 'asc' },
  });
}

/** Следующий активный вопрос строго после переданного order. */
export async function getNextActiveQuestion(
  prisma: PrismaClient,
  afterOrder: number,
): Promise<SurveyQuestion | null> {
  return prisma.surveyQuestion.findFirst({
    where: {
      scenarioId: null,
      isActive: true,
      order: { gt: afterOrder },
    },
    orderBy: { order: 'asc' },
  });
}

type AnswersObject = Record<string, Prisma.JsonValue>;

/**
 * Читает текущий surveyAnswers, мержит patch (на уровне ключей верхнего
 * уровня) и пишет обратно. Возвращает обновлённое JSON-значение.
 *
 * Используем read-modify-write вместо JSONB-операторов Postgres ради
 * простоты типов на MVP. Гонок практически нет: лид редактирует анкету
 * последовательно через бота, без параллельных апдейтов.
 */
export async function mergeSurveyAnswers(
  prisma: PrismaClient,
  leadProfileId: string,
  patch: AnswersObject,
): Promise<AnswersObject> {
  const current = await prisma.leadProfile.findUnique({
    where: { id: leadProfileId },
    select: { surveyAnswers: true },
  });
  const base = (current?.surveyAnswers as AnswersObject | null) ?? {};
  const merged: AnswersObject = { ...base, ...patch };

  await prisma.leadProfile.update({
    where: { id: leadProfileId },
    data: { surveyAnswers: merged as Prisma.InputJsonValue },
  });
  return merged;
}

/** Удаляет один ключ из surveyAnswers (используем для очистки _countryFlow). */
export async function removeSurveyAnswerKey(
  prisma: PrismaClient,
  leadProfileId: string,
  key: string,
): Promise<void> {
  const current = await prisma.leadProfile.findUnique({
    where: { id: leadProfileId },
    select: { surveyAnswers: true },
  });
  const base = (current?.surveyAnswers as AnswersObject | null) ?? {};
  if (!(key in base)) return;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [key]: _removed, ...rest } = base;
  await prisma.leadProfile.update({
    where: { id: leadProfileId },
    data: { surveyAnswers: rest as Prisma.InputJsonValue },
  });
}
