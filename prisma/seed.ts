/**
 * Оркестратор сидов. Запуск:
 *   npm run prisma:seed
 *   или автоматически после `prisma migrate dev` (см. "prisma.seed" в package.json).
 *
 * Все сиды идемпотентны — можно запускать многократно.
 */
import { PrismaClient } from '@prisma/client';
import { seedCountries } from '../scripts/seed-countries.js';
import { seedSurvey } from '../scripts/seed-survey.js';
import { seedLessons } from '../scripts/seed-lessons.js';
import { setInitialAdmin } from '../scripts/set-admin.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding countries...');
  const countries = await seedCountries(prisma);
  console.log(`  ✓ ${countries} countries`);

  console.log('Seeding survey questions...');
  const questions = await seedSurvey(prisma);
  console.log(`  ✓ ${questions} questions`);

  console.log('Seeding lessons...');
  const lessons = await seedLessons(prisma);
  console.log(`  ✓ ${lessons} lessons`);

  const initialAdminId = process.env.INITIAL_ADMIN_TELEGRAM_ID;
  if (initialAdminId) {
    console.log(`Setting initial admin (telegramUserId=${initialAdminId})...`);
    await setInitialAdmin(prisma, Number(initialAdminId));
    console.log(`  ✓ admin ready`);
  } else {
    console.warn('  ! INITIAL_ADMIN_TELEGRAM_ID not set — skipping admin seed');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
