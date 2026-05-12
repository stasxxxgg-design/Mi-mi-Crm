/**
 * Валидация ответов на обычные вопросы анкеты.
 * Зависимости: @prisma/client.
 *
 * Country-вопрос (isCountryQuestion=true) НЕ валидируется здесь — он требует
 * отдельного UI flow (кнопки + fuzzy + подтверждение), который живёт в
 * country.ts. Validator только сигнализирует диспатчеру: "это country".
 *
 * Типы валидаций (PRD §5.4):
 *   NUMBER  — validation: { min, max } → парсим int, проверяем диапазон
 *   CHOICE  — options: [{label, value}] → проверяем value ∈ allowed values
 *   TEXT    — validation: { maxLength } → проверяем длину
 *   MULTI_CHOICE / BOOLEAN — заглушки на MVP, помечены как unsupported
 */
import type { SurveyQuestion } from '@prisma/client';

export type ValidationResult =
  | { kind: 'ok'; value: string | number | boolean }
  | { kind: 'invalid'; error: string }
  | { kind: 'needs_country_flow' }
  | { kind: 'unsupported_type' };

type NumberValidation = { min?: number; max?: number };
type TextValidation = { maxLength?: number };
type ChoiceOption = { label: string; value: string };

export function validateAnswer(question: SurveyQuestion, raw: string): ValidationResult {
  if (question.isCountryQuestion) {
    return { kind: 'needs_country_flow' };
  }

  switch (question.type) {
    case 'NUMBER':
      return validateNumber(raw, (question.validation as NumberValidation | null) ?? {});
    case 'CHOICE':
      return validateChoice(raw, (question.options as ChoiceOption[] | null) ?? []);
    case 'TEXT':
      return validateText(raw, (question.validation as TextValidation | null) ?? {});
    case 'MULTI_CHOICE':
    case 'BOOLEAN':
      return { kind: 'unsupported_type' };
    default:
      return { kind: 'unsupported_type' };
  }
}

function validateNumber(raw: string, rules: NumberValidation): ValidationResult {
  const trimmed = raw.trim();
  // Жёсткая проверка целого числа — иначе "22abc" → 22, что нам не нужно.
  if (!/^-?\d+$/.test(trimmed)) {
    return { kind: 'invalid', error: buildNumberError(rules) };
  }
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) {
    return { kind: 'invalid', error: buildNumberError(rules) };
  }
  if (rules.min !== undefined && n < rules.min) {
    return { kind: 'invalid', error: buildNumberError(rules) };
  }
  if (rules.max !== undefined && n > rules.max) {
    return { kind: 'invalid', error: buildNumberError(rules) };
  }
  return { kind: 'ok', value: n };
}

function buildNumberError(rules: NumberValidation): string {
  if (rules.min !== undefined && rules.max !== undefined) {
    return `Введи число от ${rules.min} до ${rules.max}`;
  }
  if (rules.min !== undefined) return `Введи число от ${rules.min}`;
  if (rules.max !== undefined) return `Введи число до ${rules.max}`;
  return 'Введи число';
}

function validateChoice(raw: string, options: ChoiceOption[]): ValidationResult {
  const match = options.find((o) => o.value === raw);
  if (!match) {
    return { kind: 'invalid', error: 'Выбери один из вариантов с помощью кнопок' };
  }
  return { kind: 'ok', value: match.value };
}

function validateText(raw: string, rules: TextValidation): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: 'invalid', error: 'Напиши, пожалуйста, ответ текстом' };
  }
  if (rules.maxLength !== undefined && trimmed.length > rules.maxLength) {
    return { kind: 'invalid', error: `Слишком длинно — уложись в ${rules.maxLength} символов` };
  }
  return { kind: 'ok', value: trimmed };
}
