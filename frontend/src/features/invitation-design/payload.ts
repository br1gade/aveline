import {
  BLOCK_TYPES,
  BUILT_IN_FIELDS,
  type BlockEditing,
  type BlockType,
  type BuiltInField,
  type QuestionType,
} from '@/features/invitation-renderer';

import {
  takesChoices,
  type BuiltInValues,
  type LanguageCopyValues,
  type QuestionValues,
  type RsvpFieldsValues,
  type SectionFormValues,
  type ThemeValues,
} from './form-model';
import { assignKeys } from './option-keys';
import type {
  ChoiceOption,
  DesignBlock,
  Question,
  RsvpFieldsConfig,
  TemplateSummary,
} from './types';

/**
 * The bodies the design calls send. Each sends only what the host changed: a language sent
 * replaces that language's copy, one left out is kept, `null` removes it (docs/API.md §6). Guests
 * fall back to the default language block by block, not field by field (`resolveTranslation`), so
 * a language left empty is removed rather than stored empty.
 */

type JsonObject = Record<string, unknown>;

function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `PATCH /invitations/:slug/blocks/:type`. `variant: null` is the template's default layout. */
export interface SectionEdit {
  content?: Record<string, JsonObject | null>;
  settings?: JsonObject;
  variant?: string | null;
  assetIds?: string[];
}

function trimmedFields(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([name, value]): [string, string] => [name, value.trim()])
      .filter(([, value]) => value !== ''),
  );
}

/** One language's copy, written over what is stored so fields the form does not show survive. */
function languageCopy(
  stored: Readonly<JsonObject> | undefined,
  values: LanguageCopyValues,
  editing: BlockEditing,
): JsonObject | null {
  const copy: JsonObject = { ...stored };
  for (const { name } of editing.fields) delete copy[name];
  Object.assign(copy, trimmedFields(values.fields));
  if (editing.items.length > 0) {
    const items = values.items.map(trimmedFields).filter((item) => Object.keys(item).length > 0);
    delete copy.items;
    if (items.length > 0) copy.items = items;
  }
  return Object.keys(copy).length > 0 ? copy : null;
}

function contentEdit(
  block: DesignBlock,
  editing: BlockEditing,
  baseline: SectionFormValues,
  values: SectionFormValues,
): Record<string, JsonObject | null> {
  const edit: Record<string, JsonObject | null> = {};
  for (const [locale, copy] of Object.entries(values.copy)) {
    if (isSame(copy, baseline.copy[locale])) continue;
    const stored = block.content[locale];
    const written = languageCopy(stored, copy, editing);
    // An empty language that was never written stays unwritten.
    if (written !== null || stored !== undefined) edit[locale] = written;
  }
  return edit;
}

/** `settings` is replaced whole, so the stored settings are sent with the new swatches. */
function settingsEdit(block: DesignBlock, colours: readonly string[]): JsonObject {
  const rest = Object.fromEntries(
    Object.entries(block.settings).filter(([key]) => key !== 'palette'),
  );
  return colours.length > 0
    ? { ...rest, palette: colours.map((colour) => colour.toLowerCase()) }
    : rest;
}

export function sectionEdit(
  block: DesignBlock,
  editing: BlockEditing,
  baseline: SectionFormValues,
  values: SectionFormValues,
): SectionEdit {
  const content = contentEdit(block, editing, baseline, values);
  return {
    ...(Object.keys(content).length > 0 ? { content } : {}),
    ...(editing.hasSwatches && !isSame(values.colours, baseline.colours)
      ? { settings: settingsEdit(block, values.colours) }
      : {}),
    ...(values.variant === baseline.variant ? {} : { variant: values.variant || null }),
    ...(isSame(values.assetIds, baseline.assetIds) ? {} : { assetIds: [...values.assetIds] }),
  };
}

/** `PATCH /invitations/:slug/theme`: omitted means "leave as is". */
export type ThemeEdit = Partial<ThemeValues>;

export function themeEdit(baseline: ThemeValues, values: ThemeValues): ThemeEdit {
  const keys = ['headingFont', 'bodyFont', 'palette'] as const;
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== '' && values[key] !== baseline[key])
      .map((key) => [key, values[key]]),
  );
}

/** `PATCH /invitations/:slug/rsvp-fields`: each question sent replaces that one's settings. */
export type RsvpFieldsEdit = Partial<
  Record<BuiltInField, { isEnabled: boolean; options?: ChoiceOption[] | null }>
>;

const CHOICE_FIELDS: readonly BuiltInField[] = ['dietary', 'drinkPreference'];

/** A choice's label: kept in languages the form does not show, the form's over the rest. */
function choiceLabel(
  stored: ChoiceOption | undefined,
  labels: Readonly<Record<string, string>>,
): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(stored?.label ?? {}).filter(([locale]) => !Object.hasOwn(labels, locale)),
  );
  return { ...kept, ...trimmedFields(labels) };
}

function choiceOptions(
  saved: readonly ChoiceOption[] | null,
  values: BuiltInValues,
  locales: readonly string[],
): ChoiceOption[] {
  const keys = assignKeys(
    values.choices.map((choice) => ({
      key: choice.key,
      labels: locales.map((locale) => choice.labels[locale] ?? ''),
    })),
  );
  return values.choices.map((choice, position) => ({
    key: keys[position] ?? `choice-${position + 1}`,
    label: choiceLabel(
      saved?.find((option) => option.key === choice.key),
      choice.labels,
    ),
  }));
}

export function rsvpFieldsEdit(
  config: RsvpFieldsConfig,
  baseline: RsvpFieldsValues,
  values: RsvpFieldsValues,
  locales: readonly string[],
): RsvpFieldsEdit {
  const edit: RsvpFieldsEdit = {};
  for (const field of BUILT_IN_FIELDS) {
    const value = values[field];
    if (isSame(value, baseline[field])) continue;
    if (!CHOICE_FIELDS.includes(field)) {
      edit[field] = { isEnabled: value.isEnabled };
      continue;
    }
    const options = value.hasChoices ? choiceOptions(config[field].options, value, locales) : null;
    edit[field] = { isEnabled: value.isEnabled, options };
  }
  return edit;
}

export interface ChoiceListResult {
  /** Each language filled in for every choice. */
  lists: Record<string, string[]>;
  /** Languages filled in for some choices only: refused, since an answer is a position. */
  halfFilled: string[];
  /** Languages filled in for none. */
  empty: string[];
}

/** The choices per language; every language must list as many (docs/API.md §6). */
export function choiceLists(
  choices: ReadonlyArray<Readonly<Record<string, string>>>,
  locales: readonly string[],
): ChoiceListResult {
  const result: ChoiceListResult = { lists: {}, halfFilled: [], empty: [] };
  for (const locale of locales) {
    const labels = choices.map((choice) => (choice[locale] ?? '').trim());
    const filled = labels.filter(Boolean).length;
    if (filled === 0) result.empty.push(locale);
    else if (filled < labels.length) result.halfFilled.push(locale);
    else result.lists[locale] = labels;
  }
  return result;
}

/** `POST /invitations/:slug/questions`. */
export interface QuestionCreate {
  type: QuestionType;
  required: boolean;
  prompt: Record<string, string>;
  options?: Record<string, string[]>;
}

/** `PATCH …/questions/:questionId`: only the fields sent change; `null` removes a language. */
export interface QuestionEdit {
  type?: QuestionType;
  required?: boolean;
  prompt?: Record<string, string | null>;
  options?: Record<string, readonly string[] | null>;
}

/** Built from values the form's schema has checked: a prompt, and whole choice lists. */
export function questionCreate(values: QuestionValues, locales: readonly string[]): QuestionCreate {
  return {
    type: values.type,
    required: values.required,
    prompt: trimmedFields(values.prompt),
    ...(takesChoices(values.type) ? { options: choiceLists(values.choices, locales).lists } : {}),
  };
}

/** Each language changed: its new text, or `null` once emptied when it was stored. */
function translatedEdit<T>(
  stored: Readonly<Record<string, T>>,
  next: Readonly<Record<string, T>>,
  locales: readonly string[],
): Record<string, T | null> {
  const edit: Record<string, T | null> = {};
  for (const locale of locales) {
    const value = next[locale];
    if (isSame(value, stored[locale])) continue;
    if (value !== undefined) edit[locale] = value;
    else if (stored[locale] !== undefined) edit[locale] = null;
  }
  return edit;
}

export function questionEdit(
  question: Question,
  baseline: QuestionValues,
  values: QuestionValues,
  locales: readonly string[],
): QuestionEdit {
  const prompt = translatedEdit(question.prompt, trimmedFields(values.prompt), locales);
  const options = takesChoices(values.type)
    ? translatedEdit(question.options, choiceLists(values.choices, locales).lists, locales)
    : {};
  return {
    ...(values.type === baseline.type ? {} : { type: values.type }),
    ...(values.required === baseline.required ? {} : { required: values.required }),
    ...(Object.keys(prompt).length > 0 ? { prompt } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

/** `PATCH /invitations/:slug/arrangement`: array order is display order. */
export interface Arrangement {
  blocks: Array<{ type: BlockType; enabled?: boolean }>;
}

function isBlockType(type: string): type is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(type);
}

/** Whether the template can render a block type; an empty list declares no restriction. */
export function canRender(
  template: Pick<TemplateSummary, 'supportedBlocks'>,
  type: string,
): boolean {
  return template.supportedBlocks.length === 0 || template.supportedBlocks.includes(type);
}

/**
 * The sections the arrangement call accepts, in page order: known types the template renders.
 * Sending another is a 400, and the ones left out follow those sent, in their order.
 */
export function movableSections(
  blocks: readonly DesignBlock[],
  template: Pick<TemplateSummary, 'supportedBlocks'>,
): BlockType[] {
  return blocks
    .map((block) => block.type)
    .filter((type): type is BlockType => isBlockType(type) && canRender(template, type));
}

/** One section moved past its neighbour: `-1` up, `1` down. `null` when it cannot move so. */
export function moveSectionArrangement(
  blocks: readonly DesignBlock[],
  template: Pick<TemplateSummary, 'supportedBlocks'>,
  type: string,
  direction: -1 | 1,
): Arrangement | null {
  const order = movableSections(blocks, template);
  const from = order.findIndex((candidate) => candidate === type);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return null;
  const moved = [...order];
  [moved[from], moved[to]] = [order[to] as BlockType, order[from] as BlockType];
  return { blocks: moved.map((section) => ({ type: section })) };
}

/** A section the invitation lacks, added at the end and shown. */
export function addSectionArrangement(
  blocks: readonly DesignBlock[],
  template: Pick<TemplateSummary, 'supportedBlocks'>,
  type: BlockType,
): Arrangement {
  return {
    blocks: [
      ...movableSections(blocks, template).map((section) => ({ type: section })),
      { type, enabled: true },
    ],
  };
}

/** `PATCH /invitations/:slug/question-order`: every id, and the order the page read. */
export interface QuestionOrder {
  questionIds: string[];
  expectedOrder: string[];
}

export function moveQuestionOrder(
  questions: ReadonlyArray<{ id: string }>,
  id: string,
  direction: -1 | 1,
): QuestionOrder | null {
  const order = questions.map((question) => question.id);
  const from = order.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return null;
  const moved = [...order];
  [moved[from], moved[to]] = [order[to] as string, order[from] as string];
  return { questionIds: moved, expectedOrder: order };
}

/** `PATCH /events/:eventId/media/:assetId` `altText`: one language at a time. */
export function altTextEdit(
  stored: Readonly<Record<string, string>>,
  baseline: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): Record<string, string | null> {
  const edit: Record<string, string | null> = {};
  for (const [locale, value] of Object.entries(values)) {
    const text = value.trim();
    if (text === (baseline[locale] ?? '').trim()) continue;
    if (text) edit[locale] = text;
    else if (stored[locale] !== undefined) edit[locale] = null;
  }
  return edit;
}
