/**
 * Тонкая обёртка над AuditLog для funnel-событий анкеты (PRD §11).
 * Зависимости: @prisma/client.
 *
 * Все события пишутся в одну таблицу AuditLog с action-маркером, чтобы не
 * плодить таблиц под разные типы. Когда понадобится отдельная аналитика по
 * воронке (PRD §14 п.10) — поверх AuditLog'а сделаем view или вынесем в
 * отдельную FunnelEvent, миграция данных по action будет тривиальной.
 *
 * Известные actions:
 *   - survey_answered           — лид ответил на вопрос (valid answer)
 *   - survey_question_skipped   — вопрос пропущен (max attempts / unsupported)
 *   - survey_country_rejected   — лид отверг fuzzy-подсказку (промежуточное)
 *   - survey_completed          — анкета завершена
 */
import type { Prisma, PrismaClient, SurveyQuestion } from '@prisma/client';

export type FunnelAction =
  | 'survey_answered'
  | 'survey_question_skipped'
  | 'survey_country_rejected'
  | 'survey_completed';

type LeadRef = { id: string; userId: string };

type FunnelEventInput = {
  userId: string;
  action: FunnelAction;
  entityType: string;
  entityId: string;
  diff: Prisma.InputJsonValue;
};

export async function logFunnelEvent(
  prisma: PrismaClient,
  input: FunnelEventInput,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      diff: input.diff,
    },
  });
}

/** Удобная обёртка для успешного ответа. extra — например { matchedOn: 'levenshtein' }. */
export function logSurveyAnswered(
  prisma: PrismaClient,
  lead: LeadRef,
  question: SurveyQuestion,
  answer: Prisma.JsonValue,
  attempt: number,
  extra: Record<string, Prisma.JsonValue> = {},
): Promise<void> {
  return logFunnelEvent(prisma, {
    userId: lead.userId,
    action: 'survey_answered',
    entityType: 'LeadProfile',
    entityId: lead.id,
    diff: {
      questionKey: question.key,
      questionId: question.id,
      answer,
      attempt,
      valid: true,
      ...extra,
    },
  });
}

/** Удобная обёртка для пропущенного вопроса. reason — например 'max_attempts_exceeded'. */
export function logSurveyQuestionSkipped(
  prisma: PrismaClient,
  lead: LeadRef,
  question: SurveyQuestion,
  reason: string,
  attempts: number,
): Promise<void> {
  return logFunnelEvent(prisma, {
    userId: lead.userId,
    action: 'survey_question_skipped',
    entityType: 'LeadProfile',
    entityId: lead.id,
    diff: {
      questionKey: question.key,
      reason,
      attempts,
    },
  });
}

/** Лид отверг fuzzy-подсказку — промежуточное событие, чтобы было видно false-positive matches. */
export function logSurveyCountryRejected(
  prisma: PrismaClient,
  lead: LeadRef,
  question: SurveyQuestion,
  suggestedCountryId: string,
  alias: string,
): Promise<void> {
  return logFunnelEvent(prisma, {
    userId: lead.userId,
    action: 'survey_country_rejected',
    entityType: 'LeadProfile',
    entityId: lead.id,
    diff: {
      questionKey: question.key,
      suggestedCountryId,
      alias,
    },
  });
}

/** Анкета пройдена. totalQuestions — сколько активных вопросов было всего. */
export function logSurveyCompleted(
  prisma: PrismaClient,
  lead: LeadRef,
  totalQuestions: number,
): Promise<void> {
  return logFunnelEvent(prisma, {
    userId: lead.userId,
    action: 'survey_completed',
    entityType: 'LeadProfile',
    entityId: lead.id,
    diff: {
      totalQuestions,
      completedAt: new Date().toISOString(),
    },
  });
}
