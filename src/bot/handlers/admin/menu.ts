/**
 * Главное админ-меню (Day 4A финал).
 * Зависимости: grammy, BotContext, sendSurveyPanel.
 *
 * Точка входа для админа после /start. Кнопки ведут в разделы:
 *   - 📋 Анкета     — реализовано, открывает /survey
 *   - 👋 Приветствие — Day 4B (welcome-тексты + кружок Маши, заглушка)
 *   - 👤 Лиды       — Day 5-7 (заглушка)
 *   - 👥 Команда    — Day 10+ (заглушка)
 *
 * "Сценарии" и "Медиа" как отдельные разделы убраны — на этапе MVP админу
 * нужно настраивать конкретные вещи (приветствие, анкету), а не абстрактные
 * scenarios/MediaAsset из БД.
 *
 * Callback namespace `admin_menu:*` чтобы не конфликтовать с survey_admin:*
 * и edit:* / wiz:*.
 */
import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../../types.js';
import { sendSurveyPanel } from './survey.js';

const CALLBACK_PREFIX = 'admin_menu:';

export async function sendAdminMenu(ctx: BotContext): Promise<void> {
  const kb = new InlineKeyboard()
    .text('📋 Анкета', `${CALLBACK_PREFIX}survey`)
    .text('👋 Приветствие', `${CALLBACK_PREFIX}welcome`)
    .row()
    .text('👤 Лиды', `${CALLBACK_PREFIX}leads`)
    .text('👥 Команда', `${CALLBACK_PREFIX}team`);

  await ctx.reply('<b>👋 Привет, админ.</b>\n\nЧто будем делать?', {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
}

export function registerAdminMenuHandlers(composer: Composer<BotContext>): void {
  composer.command('admin', async (ctx) => {
    await sendAdminMenu(ctx);
  });

  composer.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(CALLBACK_PREFIX)) {
      await next();
      return;
    }
    await ctx.answerCallbackQuery();

    const section = data.slice(CALLBACK_PREFIX.length);
    if (section === 'survey') {
      await sendSurveyPanel(ctx);
      return;
    }
    if (section === 'welcome') {
      await ctx.reply(
        '👋 <b>Приветствие</b>\n\n<i>Тексты приветствия и welcome-кружок Маши — скоро в Day 4B.</i>',
        { parse_mode: 'HTML' },
      );
      return;
    }
    if (section === 'leads') {
      await ctx.reply('👤 <b>Лиды</b>\n\n<i>Скоро в Day 5-7.</i>', { parse_mode: 'HTML' });
      return;
    }
    if (section === 'team') {
      await ctx.reply('👥 <b>Команда</b>\n\n<i>Скоро в Day 10+.</i>', { parse_mode: 'HTML' });
      return;
    }
  });
}
