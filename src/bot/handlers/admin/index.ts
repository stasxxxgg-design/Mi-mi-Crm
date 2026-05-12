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
import { registerAdminMenuHandlers } from './menu.js';
import { registerSurveyAdminHandlers } from './survey.js';
import { registerAddSurveyConversation } from './survey-add.js';
import { registerEditSurveyConversation } from './survey-edit.js';
import { registerReorderSurveyConversation } from './survey-reorder.js';
import { registerWelcomeAdminHandlers } from './welcome.js';
import { registerEditWelcomeTextConversation } from './welcome-edit-text.js';
import type { BotContext } from '../../types.js';

export function createAdminComposer(): Composer<BotContext> {
  const composer = new Composer<BotContext>();
  composer.use(adminOnly);
  // Conversation'ы должны быть зарегистрированы ДО команд, иначе
  // ctx.conversation.enter() не найдёт wizard.
  registerAddSurveyConversation(composer);
  registerEditSurveyConversation(composer);
  registerReorderSurveyConversation(composer);
  registerEditWelcomeTextConversation(composer);
  // Главное меню (/admin) + callback-роутинг по разделам.
  registerAdminMenuHandlers(composer);
  registerSurveyAdminHandlers(composer);
  registerWelcomeAdminHandlers(composer);
  return composer;
}
