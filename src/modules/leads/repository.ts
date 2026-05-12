/**
 * Repository для админ-раздела «Лиды» (PRD §5.2-§5.3).
 * Зависимости: @prisma/client.
 *
 * Day 5 — минимум для списка + карточки:
 *   - listLeads с пагинацией и опц. поиском по nick'ам (TG + TikTok);
 *   - getLeadById с include user + assignedManager;
 *   - countLeadsByPhase для агрегата на главной панели.
 *
 * Полный поиск (имя, заметки, фаззи через trigram) и фильтры по
 * стране/фазе/тэгам/менеджеру — Day 6. Edit полей / перевод в стримера —
 * Day 7.
 */
import type { LeadPhase, LeadProfile, Prisma, PrismaClient, User } from '@prisma/client';

export type LeadWithRelations = LeadProfile & {
  user: User;
  assignedManager: User | null;
};

export type ListLeadsArgs = {
  phase?: LeadPhase;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ListLeadsResult = {
  items: LeadWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export async function listLeads(
  prisma: PrismaClient,
  args: ListLeadsArgs,
): Promise<ListLeadsResult> {
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, args.pageSize ?? DEFAULT_PAGE_SIZE));

  const where: Prisma.LeadProfileWhereInput = {};
  if (args.phase) where.phase = args.phase;

  const trimmed = args.search?.trim();
  if (trimmed) {
    where.OR = [
      // По TG username: связь user.telegramUsername (case-insensitive substring)
      { user: { telegramUsername: { contains: trimmed, mode: 'insensitive' } } },
      // По TikTok username на самом профиле
      { tiktokUsername: { contains: trimmed, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.leadProfile.findMany({
      where,
      include: { user: true, assignedManager: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.leadProfile.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function getLeadById(
  prisma: PrismaClient,
  id: string,
): Promise<LeadWithRelations | null> {
  return prisma.leadProfile.findUnique({
    where: { id },
    include: { user: true, assignedManager: true },
  });
}

/**
 * Агрегат количества лидов по фазам — для верхушки главной панели.
 * Возвращает фиксированный набор ключей (все enum-значения), даже если
 * для какой-то фазы записей нет — чтобы UI не «прыгал».
 */
export async function countLeadsByPhase(
  prisma: PrismaClient,
): Promise<Record<LeadPhase, number>> {
  const rows = await prisma.leadProfile.groupBy({
    by: ['phase'],
    _count: { _all: true },
  });
  const out: Record<LeadPhase, number> = {
    ENTERED: 0,
    TASK_COMPLETED: 0,
    MEET_INVITED: 0,
    MEET_ATTENDED: 0,
    MEET_MISSED: 0,
    STREAMER: 0,
  };
  for (const r of rows) {
    out[r.phase] = r._count._all;
  }
  return out;
}
