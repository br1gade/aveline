import { resolveTranslation } from '../../common/locale';

/**
 * How an invitation asks its built-in RSVP questions.
 *
 * The spec's rule is that a question with no consumer is not asked — so a
 * host who has no bar does not ask about drinks. And a free-text drink splits
 * one answer three ways on a trilingual event: "Wine", "Вино" and "Գինի" are
 * three rows on the bar sheet. So each built-in question can be switched off,
 * and dietary and drink can offer fixed choices: the guest picks a `key`, sees
 * its label in their language, and the sheets count keys.
 *
 * Nothing configured means what it always meant: every question on, free text.
 */
export const BUILT_IN_FIELDS = ['dietary', 'drinkPreference', 'songRequest', 'message', 'attribution'] as const;
export type BuiltInField = (typeof BUILT_IN_FIELDS)[number];

/** The questions whose answers are counted, and so can offer fixed choices. */
const CHOICE_FIELDS: readonly BuiltInField[] = ['dietary', 'drinkPreference'];

export interface FieldOption {
  key: string;
  label: Record<string, string>;
}

export interface FieldConfig {
  isEnabled: boolean;
  options: FieldOption[] | null;
}

export type RsvpFieldsConfig = Partial<Record<BuiltInField, FieldConfig>>;

const OPTION_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_OPTIONS = 30;

export function fieldOf(config: unknown, field: BuiltInField): FieldConfig {
  const stored = (config as RsvpFieldsConfig | null)?.[field];
  return { isEnabled: stored?.isEnabled ?? true, options: stored?.options ?? null };
}

/** The first problem with a host's edit, naming the field — or null. */
export function configProblem(edit: Record<string, unknown>): string | null {
  for (const [field, value] of Object.entries(edit)) {
    if (!(BUILT_IN_FIELDS as readonly string[]).includes(field)) {
      return `${field}: not a built-in question; they are ${BUILT_IN_FIELDS.join(', ')}`;
    }
    const problem = fieldEditProblem(field as BuiltInField, value);
    if (problem) return `${field}: ${problem}`;
  }
  return null;
}

/** Each field sent replaces that field's settings; `options: null` returns it to free text. */
export function mergeConfig(current: unknown, edit: Record<string, unknown>): RsvpFieldsConfig {
  const merged: RsvpFieldsConfig = { ...((current as RsvpFieldsConfig | null) ?? {}) };
  for (const [field, value] of Object.entries(edit) as [BuiltInField, Partial<FieldConfig>][]) {
    const before = fieldOf(current, field);
    merged[field] = {
      isEnabled: value.isEnabled ?? before.isEnabled,
      options: value.options === undefined ? before.options : value.options,
    };
  }
  return merged;
}

/** What a guest's form may send, given how the invitation asks — or the reason it may not. */
export function builtInAnswerProblem(config: unknown, answer: Partial<Record<BuiltInField, unknown>>): string | null {
  for (const field of BUILT_IN_FIELDS) {
    const value = answer[field];
    if (isUnanswered(value)) continue;

    const { isEnabled, options } = fieldOf(config, field);
    if (!isEnabled) return `${field}: this invitation does not ask for it`;
    if (options && !isAmongOptions(value, options)) {
      return `${field}: choose from ${options.map((option) => option.key).join(', ')}`;
    }
  }
  return null;
}

/** The questions as the guest's page shows them, labels in one language. */
export function fieldsForPage(config: unknown, locale: string, defaultLocale: string) {
  return Object.fromEntries(
    BUILT_IN_FIELDS.map((field) => {
      const { isEnabled, options } = fieldOf(config, field);
      const labelled = options?.map((option) => ({ key: option.key, label: labelOf(option, locale, defaultLocale) }));
      return [field, { isEnabled, options: labelled ?? null }];
    }),
  );
}

/** A stored answer as words: its option's label if it is one, else as typed. */
export function optionLabel(config: unknown, field: BuiltInField, value: string, locale: string): string {
  const option = fieldOf(config, field).options?.find((candidate) => candidate.key === value);
  return option ? labelOf(option, locale, locale) : value;
}

function labelOf(option: FieldOption, locale: string, defaultLocale: string): string {
  return resolveTranslation<string>(option.label, locale, defaultLocale) ?? option.key;
}

function fieldEditProblem(field: BuiltInField, value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object';
  const { isEnabled, options, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return `only isEnabled and options can be set, not ${Object.keys(rest).join(', ')}`;
  if (isEnabled !== undefined && typeof isEnabled !== 'boolean') return 'isEnabled must be true or false';
  if (options === undefined || options === null) return null;
  if (!CHOICE_FIELDS.includes(field)) return 'only dietary and drinkPreference offer fixed choices';
  return optionsProblem(options);
}

function optionsProblem(options: unknown): string | null {
  if (!Array.isArray(options) || options.length === 0 || options.length > MAX_OPTIONS) {
    return `options must be a list of 1 to ${MAX_OPTIONS}`;
  }
  const keys = new Set<string>();
  for (const option of options as Record<string, unknown>[]) {
    if (typeof option?.key !== 'string' || !OPTION_KEY.test(option.key)) {
      return 'each option needs a key of lowercase letters, digits and dashes, e.g. "red-wine"';
    }
    if (keys.has(option.key)) return `option "${option.key}" is listed twice`;
    keys.add(option.key);
    if (!isLabel(option.label)) return `option "${option.key}" needs a label in at least one language, up to 80 characters each`;
  }
  return null;
}

function isLabel(label: unknown): boolean {
  if (typeof label !== 'object' || label === null || Array.isArray(label)) return false;
  const texts = Object.values(label as Record<string, unknown>);
  return texts.length > 0 && texts.every((text) => typeof text === 'string' && text.length > 0 && text.length <= 80);
}

function isAmongOptions(value: unknown, options: FieldOption[]): boolean {
  const keys = new Set(options.map((option) => option.key));
  const chosen = Array.isArray(value) ? value : [value];
  return chosen.every((key) => typeof key === 'string' && keys.has(key));
}

/** Nothing said: an empty list or empty text from a form is not an answer. */
function isUnanswered(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}
