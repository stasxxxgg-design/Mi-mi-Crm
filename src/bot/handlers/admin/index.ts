/**
 * Composer для админ-команд. Сюда подключаются все wizard'ы /survey_*,
 * /scenario_*, /upload_media и т.д. (день 4A/4B).
 *
 * adminOnly middleware стоит первым в композере — все handler'ы внутри
 * автоматом защищены. Регистрация новых команд: просто `composer.command(...)`
 * или `composer.use(createConversation(...))`.
 *
 * Зависимости: grammy, adminOnly.
 */
import { Composer } from 'grammy';
import { adminOnly } from '../../middlewares/admin.js';
import type { BotContext } from '../../types.js';

export function createAdminComposer(): Composer<BotContext> {
  const composer = new Composer<BotContext>();
  composer.use(adminOnly);
  // Команды добавляются в следующих шагах:
  //   composer.command('survey', ...);
  //   composer.use(createConversation(addSurveyConversation, 'addSurvey'));
  //   ...
  return composer;
}
