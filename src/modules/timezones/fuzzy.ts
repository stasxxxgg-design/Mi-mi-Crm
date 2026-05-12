/**
 * Каскадный fuzzy-матчинг страны (PRD §5.5 / §6.2).
 * Зависимости: @prisma/client, fuzzystrmatch extension, pg_trgm extension.
 *
 * Каскад из трёх этапов:
 *   1) exact      — lowercase+trim, точное совпадение по name или alias.
 *   2) Levenshtein — расстояние ≤ адаптивный порог, для коротких опечаток.
 *                    Порог = LEAST(2, GREATEST(1, FLOOR(LENGTH(name)/4))):
 *                    короткие слова (4-5 букв) — 1 правка, длинные (8+) — 2.
 *   3) trigram    — pg_trgm similarity > 0.5, fallback для длинных вариаций
 *                   написания (kazakhstan↔казахстан).
 *
 * Каждый этап короткозамыкается на первом успехе. Triграммы оставляем
 * именно "длинным fallback'ом", потому что для коротких опечаток (казакстан)
 * они дают similarity лишь ~0.54 — Levenshtein там точнее.
 */
import type { Country, PrismaClient } from '@prisma/client';
import { findCountryByExactText } from './resolver.js';

export const TRIGRAM_THRESHOLD = 0.5;

export type FuzzyMatch = {
  country: Country;
  similarity: number; // 0..1
  matchedOn: 'exact' | 'levenshtein' | 'trigram';
  distance?: number; // только для levenshtein
};

/** Главная точка входа — каскад. */
export async function fuzzyFindCountry(prisma: PrismaClient, raw: string): Promise<FuzzyMatch | null> {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;

  const exact = await findCountryByExactText(prisma, normalized);
  if (exact) {
    return { country: exact, similarity: 1, matchedOn: 'exact' };
  }

  const lev = await tryLevenshtein(prisma, normalized);
  if (lev) return lev;

  return tryTrigram(prisma, normalized);
}

type LevenshteinRow = {
  id: string;
  min_dist: number;
  matched_length: number;
};

/**
 * Levenshtein: ищем минимальное расстояние по name и nameAliases.
 * Адаптивный порог зависит от длины name (а не input или alias) — это держит
 * консистентность: страны не "соревнуются" разной строгостью.
 */
async function tryLevenshtein(prisma: PrismaClient, normalized: string): Promise<FuzzyMatch | null> {
  const rows = await prisma.$queryRaw<LevenshteinRow[]>`
    WITH per_country AS (
      SELECT
        c.id,
        LEAST(2, GREATEST(1, FLOOR(LENGTH(c.name) / 4)))::int AS threshold,
        LEAST(
          levenshtein(LOWER(c.name), ${normalized}),
          COALESCE(
            (SELECT MIN(levenshtein(LOWER(alias), ${normalized}))
             FROM unnest(c."nameAliases") AS alias),
            999
          )
        ) AS min_dist,
        CASE
          WHEN levenshtein(LOWER(c.name), ${normalized}) <=
               COALESCE(
                 (SELECT MIN(levenshtein(LOWER(alias), ${normalized}))
                  FROM unnest(c."nameAliases") AS alias),
                 999
               )
            THEN LENGTH(c.name)
          ELSE
            (SELECT LENGTH(alias)
             FROM unnest(c."nameAliases") AS alias
             ORDER BY levenshtein(LOWER(alias), ${normalized}) ASC
             LIMIT 1)
        END AS matched_length
      FROM "Country" c
    )
    SELECT id, min_dist, matched_length
    FROM per_country
    WHERE min_dist <= threshold
    ORDER BY min_dist ASC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  const country = await prisma.country.findUnique({ where: { id: row.id } });
  if (!country) return null;

  // similarity = 1 - distance / length_matched_term. При distance=0 это exact'ом
  // не считается, но мы туда и не попадём — exact-этап выше уже отработал.
  const len = Math.max(row.matched_length, 1);
  return {
    country,
    similarity: Math.max(0, 1 - row.min_dist / len),
    matchedOn: 'levenshtein',
    distance: row.min_dist,
  };
}

type TrigramRow = {
  id: string;
  max_sim: number;
};

/** Trigram-фоллбек для длинных вариаций. */
async function tryTrigram(prisma: PrismaClient, normalized: string): Promise<FuzzyMatch | null> {
  const rows = await prisma.$queryRaw<TrigramRow[]>`
    SELECT id, max_sim
    FROM (
      SELECT
        c.id,
        GREATEST(
          similarity(LOWER(c.name), ${normalized}),
          COALESCE(
            (SELECT MAX(similarity(LOWER(alias), ${normalized}))
             FROM unnest(c."nameAliases") AS alias),
            0
          )
        ) AS max_sim
      FROM "Country" c
    ) sub
    WHERE max_sim >= ${TRIGRAM_THRESHOLD}
    ORDER BY max_sim DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return null;

  const country = await prisma.country.findUnique({ where: { id: row.id } });
  if (!country) return null;

  return {
    country,
    similarity: row.max_sim,
    matchedOn: 'trigram',
  };
}

/**
 * Самообучение: добавляем подтверждённый ввод в nameAliases (PRD §5.5).
 * Дедупликация — alias не добавится повторно.
 */
export async function learnAlias(
  prisma: PrismaClient,
  countryId: string,
  rawAlias: string,
): Promise<void> {
  const alias = rawAlias.trim().toLowerCase();
  if (!alias) return;

  await prisma.$executeRaw`
    UPDATE "Country"
    SET "nameAliases" = array_append("nameAliases", ${alias})
    WHERE id = ${countryId}
      AND NOT (${alias} = ANY("nameAliases"))
  `;
}
