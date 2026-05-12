/**
 * Точный матчинг страны по тексту (PRD §6.2, кнопочный + текстовый путь).
 * Зависимости: @prisma/client.
 *
 * Поведение:
 *   - lowercase + trim входной строки;
 *   - сначала case-insensitive поиск по Country.name;
 *   - потом точный поиск по lowercase-aliasу в Country.nameAliases.
 *
 * Все aliases в сидах хранятся уже lowercase'нутыми, поэтому `has` ищет точно.
 *
 * Эти функции — чистые "данные о стране", без UI и без сохранения в LeadProfile.
 * Логика survey/country.ts использует их и добавляет UX поверх.
 */
import type { Country, PrismaClient } from '@prisma/client';

/** Точный матч по name или nameAliases. Возвращает null если не нашли. */
export async function findCountryByExactText(
  prisma: PrismaClient,
  raw: string,
): Promise<Country | null> {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;

  // Match по name — через mode:'insensitive', чтобы не плодить дубли в nameAliases
  // (вариант "Польша" и "польша" не нужен в массиве, name сам справится).
  const byName = await prisma.country.findFirst({
    where: { name: { equals: normalized, mode: 'insensitive' } },
  });
  if (byName) return byName;

  // Match по nameAliases — сидим всегда lowercase, поэтому `has` хватит.
  return prisma.country.findFirst({
    where: { nameAliases: { has: normalized } },
  });
}

/** Топ-страны для кнопочного списка (PRD §5.4, isTopCountry=true). */
export function listTopCountries(prisma: PrismaClient): Promise<Country[]> {
  return prisma.country.findMany({
    where: { isTopCountry: true },
    orderBy: { name: 'asc' },
  });
}

/** Поиск по ISO-коду — для коллбэка от кнопки топ-страны. */
export function findCountryByIso(prisma: PrismaClient, isoCode: string): Promise<Country | null> {
  return prisma.country.findUnique({ where: { isoCode } });
}
