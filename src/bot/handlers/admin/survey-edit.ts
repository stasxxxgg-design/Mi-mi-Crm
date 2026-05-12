/**
 * Wizard /survey_edit + меню действий по вопросу (Day 4A Шаг 4).
 * Зависимости: grammy, @grammyjs/conversations, prisma, _wizard-common.
 *
 * Поток:
 *   - принимает key (из команды или из callback'а кнопки в /survey);
 *   - крутит цикл "показать меню → выбрать field → отредактировать →
 *     вернуться в меню", пока юзер не нажмёт ✅ Готово или /cancel;
 *   - архивация / восстановление прямо здесь же кнопкой
 *     (бывшая /survey_remove живёт в этом же flow).
 *
 * key менять НЕ даём: ответы лидов лежат в LeadProfile.surveyAnswers JSON
 * под старым ключом, переименование разорвёт связь.
 *
 * Type-change выводит warning и спрашивает подтверждение, потому что меняет
 * интерпретацию старых ответов. После смены типа options/validation
 * пересоздаются под новый тип; старое значение обнуляется.
 *
 * Callback-namespace `edit:*` — отдельный от `wiz:*` в _wizard-common,
 * чтобы wait-for-regex не перехватывались чужими шагами.
 */
import { InlineKeyboard, type Composer } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import type { SurveyQuestion } from '@prisma/client';
import { prisma } from '../../../core/db.js';
import type { BotContext } from '../../types.js';
import {
  CancelError,
  askHint,
  askIsRequired,
  askNumberValidation,
  askOptions,
  askOrder,
  askQuestion,
  askTextValidation,
  askType,
  askYesNo,
  escapeHtml,
  type ChoiceOption,
  type WizardConversation,
} from './_wizard-common.js';

export const EDIT_SURVEY_CONVERSATION_ID = 'editSurvey';

type MenuAction =
  | 'question'
  | 'hint'
  | 'type'
  | 'options'
  | 'validation'
  | 'isRequired'
  | 'order'
  | 'isCountryQuestion'
  | 'archive'
  | 'restore'
  | 'done'
  | 'cancel';

/**
 * focus='archive' — захардкоженный shortcut для /survey_remove: открывает
 * вопрос и сразу запускает archive flow, минуя меню. После завершения
 * (успех или отмена) выходим — иначе UX странный, пользователь хотел
 * именно удалить, а попал в общий редактор.
 */
async function wizard(
  conversation: WizardConversation,
  ctx: BotContext,
  key: string,
  focus?: 'archive',
): Promise<void> {
  let q = await conversation.external(() =>
    prisma.surveyQuestion.findFirst({ where: { scenarioId: null, key } }),
  );
  if (!q) {
    await ctx.reply(
      `Вопроса <code>${escapeHtml(key)}</code> не нашёл. Используй /survey для списка.`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (focus === 'archive') {
    try {
      await archive(conversation, ctx, q);
    } catch (err) {
      if (err instanceof CancelError) {
        await ctx.reply('Архивирование отменено.');
        return;
      }
      throw err;
    }
    return;
  }

  while (true) {
    const action = await showMenu(conversation, ctx, q);

    if (action === 'done') {
      await ctx.reply('✅ Готово. Текущее состояние: /survey');
      return;
    }
    if (action === 'cancel') {
      await ctx.reply('Редактирование отменено.');
      return;
    }

    try {
      const updated = await applyAction(conversation, ctx, q, action);
      if (updated) q = updated;
    } catch (err) {
      if (err instanceof CancelError) {
        // /cancel внутри одного field — возвращаемся в меню, не выходим.
        await ctx.reply('Изменение поля отменено. Возвращаюсь в меню.');
        continue;
      }
      throw err;
    }
  }
}

// ============ menu ============

async function showMenu(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
): Promise<MenuAction> {
  const lines: string[] = [];
  lines.push(
    `<b>✏️ Редактирование:</b> <code>${escapeHtml(q.key)}</code> · ${q.type} · ${
      q.isRequired ? 'обязательный' : 'необязательный'
    } · order=${q.order}${q.isActive ? '' : ' · <i>архивный</i>'}`,
  );
  lines.push(escapeHtml(q.question));
  if (q.hint) lines.push(`<i>${escapeHtml(q.hint)}</i>`);
  if (q.isCountryQuestion) lines.push('<i>country-вопрос 🌍</i>');
  lines.push('');
  lines.push('🔒 <i>Ключ менять нельзя — для переименования создай новый и удали старый.</i>');

  const kb = new InlineKeyboard()
    .text('Текст', 'edit:field:question')
    .text('Подсказка', 'edit:field:hint')
    .row()
    .text('Тип ⚠', 'edit:field:type');
  if (q.type === 'CHOICE') {
    kb.text('Варианты', 'edit:field:options');
  } else if (q.type === 'NUMBER' || q.type === 'TEXT') {
    kb.text('Валидация', 'edit:field:validation');
  }
  kb.row()
    .text('Обязательный', 'edit:field:isRequired')
    .text('Порядок', 'edit:field:order')
    .row()
    .text('country?', 'edit:field:isCountryQuestion')
    .row();

  if (q.isActive) {
    kb.text('📦 Архивировать', 'edit:field:archive');
  } else {
    kb.text('📤 Восстановить', 'edit:field:restore');
  }
  kb.row().text('✅ Готово', 'edit:done').text('❌ Отмена', 'edit:cancel');

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });

  while (true) {
    const next = await conv.waitForCallbackQuery(/^edit:/);
    await next.answerCallbackQuery();
    const parts = next.callbackQuery.data.split(':');
    if (parts[1] === 'done') return 'done';
    if (parts[1] === 'cancel') return 'cancel';
    if (parts[1] === 'field' && parts[2]) {
      return parts[2] as MenuAction;
    }
  }
}

// ============ actions ============

async function applyAction(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
  action: MenuAction,
): Promise<SurveyQuestion | null> {
  switch (action) {
    case 'question': {
      const v = await askQuestion(conv, ctx);
      return await conv.external(() =>
        prisma.surveyQuestion.update({ where: { id: q.id }, data: { question: v } }),
      );
    }
    case 'hint': {
      const v = await askHint(conv, ctx);
      return await conv.external(() =>
        prisma.surveyQuestion.update({ where: { id: q.id }, data: { hint: v } }),
      );
    }
    case 'type':
      return await changeType(conv, ctx, q);
    case 'options':
      return await changeOptions(conv, ctx, q);
    case 'validation':
      return await changeValidation(conv, ctx, q);
    case 'isRequired': {
      const v = await askIsRequired(conv, ctx);
      return await conv.external(() =>
        prisma.surveyQuestion.update({ where: { id: q.id }, data: { isRequired: v } }),
      );
    }
    case 'order': {
      const v = await askOrder(conv, ctx, q.order, q.id);
      return await conv.external(() =>
        prisma.surveyQuestion.update({ where: { id: q.id }, data: { order: v } }),
      );
    }
    case 'isCountryQuestion':
      return await changeIsCountryQuestion(conv, ctx, q);
    case 'archive':
      return await archive(conv, ctx, q);
    case 'restore':
      return await restore(conv, ctx, q);
    default:
      return null;
  }
}

async function changeType(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
): Promise<SurveyQuestion | null> {
  const warn = await askYesNo(
    conv,
    ctx,
    '⚠️ <b>Смена типа повлияет на интерпретацию старых ответов лидов.</b>\n\nПродолжить?',
    'Да, менять',
    'Отмена',
  );
  if (!warn) return null;

  const newType = await askType(conv, ctx);
  if (newType === q.type) {
    await ctx.reply('Тип не изменился, оставляю как есть.');
    return null;
  }

  let options: ChoiceOption[] | null = null;
  let validation: Record<string, number> | null = null;
  if (newType === 'CHOICE') {
    options = await askOptions(conv, ctx);
  } else if (newType === 'NUMBER') {
    validation = await askNumberValidation(conv, ctx);
  } else if (newType === 'TEXT') {
    validation = await askTextValidation(conv, ctx);
  }

  return await conv.external(() =>
    prisma.surveyQuestion.update({
      where: { id: q.id },
      data: {
        type: newType,
        options: options ?? undefined,
        validation: validation ?? undefined,
        // Если новый тип не требует одного из полей — очищаем явно.
        ...(newType !== 'CHOICE' ? { options: undefined } : {}),
        ...(newType === 'CHOICE' || newType === 'BOOLEAN' ? { validation: undefined } : {}),
      },
    }),
  );
}

async function changeOptions(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
): Promise<SurveyQuestion | null> {
  if (q.type !== 'CHOICE') {
    await ctx.reply('Варианты есть только у CHOICE-вопросов.');
    return null;
  }
  const options = await askOptions(conv, ctx);
  return await conv.external(() =>
    prisma.surveyQuestion.update({ where: { id: q.id }, data: { options } }),
  );
}

async function changeValidation(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
): Promise<SurveyQuestion | null> {
  let validation: Record<string, number> | null = null;
  if (q.type === 'NUMBER') {
    validation = await askNumberValidation(conv, ctx);
  } else if (q.type === 'TEXT') {
    validation = await askTextValidation(conv, ctx);
  } else {
    await ctx.reply('У этого типа нет валидации.');
    return null;
  }
  return await conv.external(() =>
    prisma.surveyQuestion.update({ where: { id: q.id }, data: { validation } }),
  );
}

async function changeIsCountryQuestion(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
): Promise<SurveyQuestion | null> {
  if (q.isCountryQuestion) {
    const confirm = await askYesNo(
      conv,
      ctx,
      '<b>Снять country-флаг?</b>\n\nВопрос станет обычным CHOICE без логики топ-стран и fuzzy.',
    );
    if (!confirm) return null;
    return await conv.external(() =>
      prisma.surveyQuestion.update({ where: { id: q.id }, data: { isCountryQuestion: false } }),
    );
  }

  const existing = await conv.external(() =>
    prisma.surveyQuestion.findFirst({
      where: {
        scenarioId: null,
        isCountryQuestion: true,
        isActive: true,
        NOT: { id: q.id },
      },
    }),
  );
  if (existing) {
    await ctx.reply(
      `Уже есть country-вопрос: <code>${escapeHtml(existing.key)}</code>. Сначала сними флаг у него.`,
      { parse_mode: 'HTML' },
    );
    return null;
  }
  const confirm = await askYesNo(
    conv,
    ctx,
    '<b>Сделать country-вопрос?</b>\n\nВключит спец-логику с топ-странами и fuzzy match.',
  );
  if (!confirm) return null;
  return await conv.external(() =>
    prisma.surveyQuestion.update({ where: { id: q.id }, data: { isCountryQuestion: true } }),
  );
}

async function archive(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
): Promise<SurveyQuestion | null> {
  if (!q.isActive) {
    await ctx.reply('Вопрос уже архивный.');
    return null;
  }
  const confirm = await askYesNo(
    conv,
    ctx,
    `📦 <b>Архивировать <code>${escapeHtml(q.key)}</code>?</b>\n\nОтветы лидов сохранятся, новые лиды его не получат.`,
    'Да, архивировать',
    'Отмена',
  );
  if (!confirm) return null;
  const updated = await conv.external(() =>
    prisma.surveyQuestion.update({ where: { id: q.id }, data: { isActive: false } }),
  );
  await ctx.reply(`Вопрос <code>${escapeHtml(q.key)}</code> архивирован.`, {
    parse_mode: 'HTML',
  });
  return updated;
}

async function restore(
  conv: WizardConversation,
  ctx: BotContext,
  q: SurveyQuestion,
): Promise<SurveyQuestion | null> {
  if (q.isActive) {
    await ctx.reply('Вопрос уже активный.');
    return null;
  }
  const confirm = await askYesNo(
    conv,
    ctx,
    `📤 <b>Восстановить <code>${escapeHtml(q.key)}</code>?</b>\n\nНовые лиды снова будут его видеть.`,
  );
  if (!confirm) return null;
  const updated = await conv.external(() =>
    prisma.surveyQuestion.update({ where: { id: q.id }, data: { isActive: true } }),
  );
  await ctx.reply(`Вопрос <code>${escapeHtml(q.key)}</code> восстановлен.`, {
    parse_mode: 'HTML',
  });
  return updated;
}

// ============ registration ============

export function registerEditSurveyConversation(composer: Composer<BotContext>): void {
  composer.use(createConversation(wizard, EDIT_SURVEY_CONVERSATION_ID));

  composer.command('survey_edit', async (ctx) => {
    const key = (typeof ctx.match === 'string' ? ctx.match : '').trim();
    if (!key) {
      await ctx.reply(
        'Использование: <code>/survey_edit &lt;key&gt;</code>\n\nНапример: <code>/survey_edit age</code>\n\nИли открой /survey и нажми кнопку нужного вопроса.',
        { parse_mode: 'HTML' },
      );
      return;
    }
    await ctx.conversation.enter(EDIT_SURVEY_CONVERSATION_ID, key);
  });

  // Shortcut на archive: тот же wizard, но focus='archive' — сразу
  // в подтверждение, без меню. UI-эквивалент кнопки 📦 в /survey_edit.
  composer.command('survey_remove', async (ctx) => {
    const key = (typeof ctx.match === 'string' ? ctx.match : '').trim();
    if (!key) {
      await ctx.reply(
        'Использование: <code>/survey_remove &lt;key&gt;</code>\n\nИли открой /survey, нажми вопрос и выбери 📦 Архивировать.',
        { parse_mode: 'HTML' },
      );
      return;
    }
    await ctx.conversation.enter(EDIT_SURVEY_CONVERSATION_ID, key, 'archive');
  });
}
