/**
 * Wizard /survey_reorder + кнопка [↕ Порядок] (Day 4A Шаг 6).
 * Зависимости: grammy, @grammyjs/conversations, prisma, _wizard-common.
 *
 * Поток:
 *   - выводим текущий порядок активных вопросов,
 *   - просим ввести keys через запятую в новом порядке (без чисел —
 *     с числами легче запутаться, какой order был раньше);
 *   - валидируем: тот же набор ключей, без повторов, без лишних;
 *   - применяем через $transaction в две фазы:
 *       Phase 1 — order += 10000 (увод в фантомный диапазон);
 *       Phase 2 — новый order по позиции в массиве.
 *     Это обход postgres unique(scenarioId, order) — он immediate, и
 *     прямое переприсваивание ловит constraint violation на пересечении.
 */
import type { Composer } from 'grammy';
import { createConversation } from '@grammyjs/conversations';
import { prisma } from '../../../core/db.js';
import type { BotContext } from '../../types.js';
import {
  CancelError,
  checkCancel,
  escapeHtml,
  type WizardConversation,
} from './_wizard-common.js';

export const REORDER_SURVEY_CONVERSATION_ID = 'reorderSurvey';

const PHANTOM_OFFSET = 10000;

async function wizard(conversation: WizardConversation, ctx: BotContext): Promise<void> {
  const active = await conversation.external(() =>
    prisma.surveyQuestion.findMany({
      where: { scenarioId: null, isActive: true },
      orderBy: { order: 'asc' },
    }),
  );

  if (active.length < 2) {
    await ctx.reply('Активных вопросов меньше двух — менять порядок не нужно.');
    return;
  }

  const lines: string[] = [];
  lines.push('<b>↕ Изменение порядка</b>');
  lines.push('');
  lines.push('<b>Сейчас:</b>');
  for (const q of active) {
    lines.push(`${q.order}. <code>${escapeHtml(q.key)}</code>`);
  }
  lines.push('');
  lines.push('Введи ключи через запятую в новом порядке. /cancel чтобы выйти.');
  lines.push('');
  lines.push(`Пример: <code>${active.map((q) => escapeHtml(q.key)).join(', ')}</code>`);
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });

  try {
    while (true) {
      const next = await conversation.waitFor('message:text');
      const text = next.message.text.trim();
      checkCancel(text);

      const parsed = parseReorderInput(
        text,
        active.map((q) => q.key),
      );
      if (!parsed.ok) {
        await next.reply(parsed.error);
        continue;
      }

      // ВАЖНО: два прохода в одной транзакции. Прямое присваивание дало бы
      // unique violation на пересечении пар (новый order одного = старый
      // order другого ещё не обработанного).
      await conversation.external(() =>
        prisma.$transaction(async (tx) => {
          for (const q of active) {
            await tx.surveyQuestion.update({
              where: { id: q.id },
              data: { order: q.order + PHANTOM_OFFSET },
            });
          }
          for (let i = 0; i < parsed.keys.length; i++) {
            const key = parsed.keys[i];
            if (!key) continue;
            const q = active.find((x) => x.key === key);
            if (!q) continue;
            await tx.surveyQuestion.update({
              where: { id: q.id },
              data: { order: i + 1 },
            });
          }
        }),
      );

      await ctx.reply('✅ Порядок обновлён. Глянь /survey.');
      return;
    }
  } catch (err) {
    if (err instanceof CancelError) {
      await ctx.reply('Изменение порядка отменено.');
      return;
    }
    throw err;
  }
}

function parseReorderInput(
  raw: string,
  activeKeys: string[],
): { ok: true; keys: string[] } | { ok: false; error: string } {
  // Разрешаем запятую и/или пробел как разделители — пользователю удобнее.
  const inputKeys = raw
    .split(/[,\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  if (inputKeys.length !== activeKeys.length) {
    return {
      ok: false,
      error: `Ожидаю ${activeKeys.length} ключей, получил ${inputKeys.length}. Попробуй ещё раз.`,
    };
  }

  const active = new Set(activeKeys);
  const seen = new Set<string>();
  for (const k of inputKeys) {
    if (!active.has(k)) {
      return { ok: false, error: `Ключа "${k}" нет среди активных вопросов.` };
    }
    if (seen.has(k)) {
      return { ok: false, error: `Ключ "${k}" встречается дважды.` };
    }
    seen.add(k);
  }
  return { ok: true, keys: inputKeys };
}

export function registerReorderSurveyConversation(composer: Composer<BotContext>): void {
  composer.use(createConversation(wizard, REORDER_SURVEY_CONVERSATION_ID));
  composer.command('survey_reorder', async (ctx) => {
    await ctx.conversation.enter(REORDER_SURVEY_CONVERSATION_ID);
  });
}
