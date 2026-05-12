/**
 * Раздел «👤 Лиды» (Day 5 — Шаги 2 и 3, PRD §5.2-§5.3).
 * Зависимости: grammy, @grammyjs/conversations, prisma, leads repository.
 *
 * Что есть в Day 5:
 *   - sendLeadsPanel — главная панель (агрегат + список + кнопки) с
 *     опциональным `search` параметром.
 *   - Pagination для основного режима (без search): callback
 *     leads:page:<n>. В режиме поиска показываем только первую страницу —
 *     иначе search-state нужно сохранять между callback-ами (Day 6).
 *   - Conversation leadsSearch: ждёт текст и зовёт sendLeadsPanel со
 *     search-аргументом.
 *   - Карточка лида (Шаг 3) пока в виде readonly-рендера + edit-кнопки-
 *     заглушки на Day 6/7.
 *
 * Callback namespace `leads:*`.
 */
import { Composer, InlineKeyboard } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import type { User } from '@prisma/client';
import { prisma } from '../../../core/db.js';
import {
  countLeadsByPhase,
  getLeadById,
  listLeads,
  type LeadWithRelations,
  type ListLeadsResult,
} from '../../../modules/leads/repository.js';
import {
  CancelError,
  checkCancel,
  escapeHtml,
  type WizardConversation,
} from './_wizard-common.js';
import type { BotContext } from '../../types.js';

const CALLBACK_PREFIX = 'leads:';
const SEARCH_CONVERSATION_ID = 'leadsSearch';

// ============ panel ============

export async function sendLeadsPanel(
  ctx: BotContext,
  page = 1,
  search?: string,
): Promise<void> {
  const trimmedSearch = search?.trim() || undefined;
  const result = await listLeads(prisma, { search: trimmedSearch, page });

  const lines: string[] = [];

  if (trimmedSearch) {
    lines.push(`<b>🔍 Поиск:</b> <code>${escapeHtml(trimmedSearch)}</code>`);
    lines.push(`Найдено: <b>${result.total}</b>`);
  } else {
    const counts = await countLeadsByPhase(prisma);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    lines.push(`<b>👤 Лиды (всего ${total})</b>`);
    lines.push('');
    lines.push('<b>📊 По фазам:</b>');
    lines.push(`• ENTERED — ${counts.ENTERED}`);
    lines.push(`• TASK_COMPLETED — ${counts.TASK_COMPLETED}`);
    lines.push(`• MEET_INVITED — ${counts.MEET_INVITED}`);
    lines.push(`• MEET_ATTENDED — ${counts.MEET_ATTENDED}`);
    lines.push(`• MEET_MISSED — ${counts.MEET_MISSED}`);
    lines.push(`• STREAMER — ${counts.STREAMER}`);
  }

  lines.push('');
  if (result.items.length === 0) {
    lines.push(trimmedSearch ? '<i>Никого не нашлось.</i>' : '<i>Лидов ещё нет.</i>');
  } else {
    lines.push(
      `<b>Страница ${result.page}/${result.totalPages}</b> · показано ${result.items.length} из ${result.total}`,
    );
    lines.push('');
    result.items.forEach((lead, i) => {
      const absIdx = (result.page - 1) * result.pageSize + i + 1;
      lines.push(renderLeadLine(lead, absIdx));
    });
    if (trimmedSearch && result.total > result.pageSize) {
      lines.push('');
      lines.push('<i>Показана только первая страница поиска. Уточни запрос или используй фильтры (Day 6).</i>');
    }
  }

  const kb = buildPanelKeyboard(result, trimmedSearch);
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

function renderLeadLine(lead: LeadWithRelations, index: number): string {
  const handle = displayHandle(lead.user);
  const country = lead.country ?? '?';
  const created = formatDateRU(lead.createdAt);
  return `${index}. ${escapeHtml(handle)} · ${lead.phase} · ${escapeHtml(country)} · ${created}`;
}

function buildPanelKeyboard(result: ListLeadsResult, search?: string): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Кнопки на каждого лида — 2 в ряд.
  for (let i = 0; i < result.items.length; i += 2) {
    const l1 = result.items[i];
    if (!l1) continue;
    const idx1 = (result.page - 1) * result.pageSize + i + 1;
    kb.text(makeButtonLabel(l1, idx1), `${CALLBACK_PREFIX}open:${l1.id}`);
    const l2 = result.items[i + 1];
    if (l2) {
      const idx2 = idx1 + 1;
      kb.text(makeButtonLabel(l2, idx2), `${CALLBACK_PREFIX}open:${l2.id}`);
    }
    kb.row();
  }

  // Пагинация (только в режиме без поиска — search-state в callback'е не
  // упаковываем, чтобы не упереться в 64-байтный лимит и спецсимволы).
  if (!search && result.totalPages > 1) {
    if (result.page > 1) kb.text('◀', `${CALLBACK_PREFIX}page:${result.page - 1}`);
    kb.text(`${result.page}/${result.totalPages}`, `${CALLBACK_PREFIX}noop`);
    if (result.page < result.totalPages) {
      kb.text('▶', `${CALLBACK_PREFIX}page:${result.page + 1}`);
    }
    kb.row();
  }

  // Команды
  if (search) {
    kb.text('🔍 Новый поиск', `${CALLBACK_PREFIX}search`);
    kb.text('📋 Все лиды', `${CALLBACK_PREFIX}reset`);
  } else {
    kb.text('🔍 Поиск', `${CALLBACK_PREFIX}search`);
  }
  kb.row().text('← Назад', 'admin_menu:main');

  return kb;
}

function makeButtonLabel(lead: LeadWithRelations, index: number): string {
  const handle = displayHandle(lead.user);
  // 20-байтная буква в UTF-8 ≈ 10 кириллических символов; обрезаем чуть больше.
  const safe = handle.length > 16 ? handle.slice(0, 14) + '…' : handle;
  return `${index}. ${safe}`;
}

function displayHandle(user: User): string {
  if (user.telegramUsername) return `@${user.telegramUsername}`;
  const parts = [user.firstName, user.lastName].filter(Boolean) as string[];
  if (parts.length > 0) return parts.join(' ');
  return `id${user.telegramUserId}`;
}

function formatDateRU(d: Date): string {
  // Краткий формат без библиотек — лишних 50KB интла не тащим.
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

// ============ card (Шаг 3) ============

export async function sendLeadCard(ctx: BotContext, leadId: string): Promise<void> {
  const lead = await getLeadById(prisma, leadId);
  if (!lead) {
    await ctx.reply('Лид не найден.');
    return;
  }

  const lines: string[] = [];
  const handle = displayHandle(lead.user);
  lines.push(`<b>👤 ${escapeHtml(handle)}</b>`);
  lines.push(
    `Telegram ID: <code>${lead.user.telegramUserId}</code> · Создан: ${formatDateRU(lead.createdAt)}`,
  );
  if (lead.sourceCode) {
    lines.push(`Источник: <code>${escapeHtml(lead.sourceCode)}</code>`);
  }
  lines.push('');

  lines.push(`<b>📊 Фаза:</b> ${lead.phase}` + (lead.promotedToStreamerAt
    ? ` (с ${formatDateRU(lead.promotedToStreamerAt)})` : ''));
  lines.push(`<b>Статус:</b> ${lead.status}`);
  if (lead.phase === 'STREAMER') {
    lines.push(`<b>Текущий урок:</b> ${lead.currentLessonNumber}`);
  }
  if (lead.assignedManager) {
    const mgr = displayHandle(lead.assignedManager);
    const since = lead.assignedAt ? ` (с ${formatDateRU(lead.assignedAt)})` : '';
    lines.push(`<b>Менеджер:</b> ${escapeHtml(mgr)}${since}`);
  }
  if (lead.countryNeedsReview) {
    lines.push('⚠️ <i>Страна не распознана автоматически — проверь</i>');
  }
  lines.push('');

  lines.push('<b>📋 Анкета:</b>');
  const answers = (lead.surveyAnswers as Record<string, unknown> | null) ?? {};
  const visibleKeys = Object.keys(answers).filter((k) => !k.startsWith('_'));
  if (visibleKeys.length === 0) {
    lines.push('<i>пусто</i>');
  } else {
    for (const key of visibleKeys) {
      const v = answers[key];
      lines.push(`• <code>${escapeHtml(key)}</code>: ${escapeHtml(formatAnswer(v))}`);
    }
  }
  if (lead.timezone) {
    lines.push(`• <code>timezone</code>: ${escapeHtml(lead.timezone)}`);
  }
  lines.push('');

  // Дополнительные поля (заполняются админом отдельно)
  const extras: string[] = [];
  if (lead.tiktokUsername) extras.push(`TikTok: <code>${escapeHtml(lead.tiktokUsername)}</code>`);
  if (lead.englishLevel) extras.push(`English: ${lead.englishLevel}`);
  if (lead.birthPlace) extras.push(`Место рождения: ${escapeHtml(lead.birthPlace)}`);
  if (extras.length > 0) {
    lines.push('<b>📱 Дополнительно:</b>');
    extras.forEach((e) => lines.push(`• ${e}`));
    lines.push('');
  }

  if (lead.tags.length > 0) {
    lines.push('<b>🏷 Тэги:</b> ' + lead.tags.map((t) => escapeHtml(t)).join(', '));
    lines.push('');
  }

  if (lead.adminNotes) {
    lines.push('<b>📝 Заметки:</b>');
    lines.push(escapeHtml(lead.adminNotes));
    lines.push('');
  }

  const kb = new InlineKeyboard()
    .text('✏️ Заметки', `${CALLBACK_PREFIX}edit:notes:${lead.id}`)
    .text('🏷 Тэги', `${CALLBACK_PREFIX}edit:tags:${lead.id}`)
    .row()
    .text('📊 Статус', `${CALLBACK_PREFIX}edit:status:${lead.id}`)
    .text('👨‍💼 Менеджер', `${CALLBACK_PREFIX}edit:manager:${lead.id}`)
    .row()
    .text('→ В стримера', `${CALLBACK_PREFIX}edit:promote:${lead.id}`)
    .row()
    .text('← К списку', `${CALLBACK_PREFIX}back`);

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

function formatAnswer(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// ============ search conversation ============

async function searchWizard(conversation: WizardConversation, ctx: BotContext): Promise<void> {
  await ctx.reply(
    '🔍 <b>Поиск лидов</b>\n\nВведи часть ника (Telegram или TikTok). /cancel для отмены.',
    { parse_mode: 'HTML' },
  );

  try {
    const next = await conversation.waitFor('message:text');
    const text = next.message.text.trim();
    checkCancel(text);
    if (!text) {
      await ctx.reply('Пустой запрос. Поиск отменён.');
      return;
    }
    if (text.length > 100) {
      await ctx.reply('Слишком длинный запрос (max 100).');
      return;
    }
    await conversation.external(async () => {
      await sendLeadsPanel(ctx, 1, text);
    });
  } catch (err) {
    if (err instanceof CancelError) {
      await ctx.reply('Поиск отменён.');
      return;
    }
    throw err;
  }
}

// ============ registration ============

export function registerLeadsAdminHandlers(composer: Composer<BotContext>): void {
  composer.use(createConversation(searchWizard, SEARCH_CONVERSATION_ID));

  composer.command('leads', async (ctx) => {
    await sendLeadsPanel(ctx);
  });

  composer.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(CALLBACK_PREFIX)) {
      await next();
      return;
    }
    await ctx.answerCallbackQuery();

    const action = data.slice(CALLBACK_PREFIX.length);

    if (action === 'noop') return;

    if (action === 'search') {
      await ctx.conversation.enter(SEARCH_CONVERSATION_ID);
      return;
    }
    if (action === 'reset') {
      await sendLeadsPanel(ctx);
      return;
    }
    if (action === 'back') {
      await sendLeadsPanel(ctx);
      return;
    }
    if (action.startsWith('page:')) {
      const page = parseInt(action.slice('page:'.length), 10);
      if (!Number.isNaN(page) && page >= 1) {
        await sendLeadsPanel(ctx, page);
      }
      return;
    }
    if (action.startsWith('open:')) {
      const id = action.slice('open:'.length);
      if (id) await sendLeadCard(ctx, id);
      return;
    }
    if (action.startsWith('edit:')) {
      // TODO Day 7: wizard'ы для notes / tags / status / manager / promote.
      await ctx.reply('Редактирование полей лида — Day 7.');
      return;
    }
  });
}

