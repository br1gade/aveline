import {
  BUILT_IN_FIELDS,
  type BlockEditing,
  type BuiltInField,
  type QuestionType,
} from '@/features/invitation-renderer';

import type { DesignBlock, Question, RsvpFieldsConfig, Theme } from './types';

/**
 * What each design form starts from. Every form edits the event's languages only, each in its own
 * place, so a save can send exactly the languages the host touched (docs/API.md §6: a language
 * sent replaces that language, one left out is kept, `null` removes it).
 */

/** One language of a block's copy: its fields, and NOTES' items. */
export interface LanguageCopyValues {
  fields: Record<string, string>;
  items: Array<Record<string, string>>;
}

export interface SectionFormValues {
  /** `''` is the template's default layout. */
  variant: string;
  copy: Record<string, LanguageCopyValues>;
  /** DRESS_CODE's swatches, lowercase six-digit hex. */
  colours: string[];
  /** The media shown, in order. */
  assetIds: string[];
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function itemsOf(value: unknown, editing: BlockEditing): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) => {
    const stored =
      typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    return Object.fromEntries(editing.items.map(({ name }) => [name, textOf(stored[name])]));
  });
}

function swatchesOf(settings: Readonly<Record<string, unknown>>): string[] {
  const palette = settings.palette;
  if (!Array.isArray(palette)) return [];
  return palette
    .filter((colour): colour is string => typeof colour === 'string' && HEX_COLOUR.test(colour))
    .map((colour) => colour.toLowerCase());
}

export function sectionFormValues(
  block: DesignBlock,
  editing: BlockEditing,
  locales: readonly string[],
): SectionFormValues {
  const copy = Object.fromEntries(
    locales.map((locale): [string, LanguageCopyValues] => {
      const stored = block.content[locale] ?? {};
      return [
        locale,
        {
          fields: Object.fromEntries(
            editing.fields.map(({ name }) => [name, textOf(stored[name])]),
          ),
          items: itemsOf(stored.items, editing),
        },
      ];
    }),
  );
  return {
    variant: block.variant ?? '',
    copy,
    colours: swatchesOf(block.settings),
    assetIds: [...block.assetIds],
  };
}

/** `''` where the host has not chosen and the template sets nothing. */
export interface ThemeValues {
  headingFont: string;
  bodyFont: string;
  palette: string;
}

export function themeFormValues(theme: Theme): ThemeValues {
  return {
    headingFont: theme.headingFont ?? '',
    bodyFont: theme.bodyFont ?? '',
    palette: theme.palette ?? '',
  };
}

/** A built-in choice: its saved key (`''` for a new one) and its label in each language. */
export interface ChoiceValues {
  key: string;
  labels: Record<string, string>;
}

export interface BuiltInValues {
  isEnabled: boolean;
  /** Fixed choices rather than free text; dietary and drink only. */
  hasChoices: boolean;
  choices: ChoiceValues[];
}

export type RsvpFieldsValues = Record<BuiltInField, BuiltInValues>;

export function rsvpFieldsFormValues(
  config: RsvpFieldsConfig,
  locales: readonly string[],
): RsvpFieldsValues {
  const entries = BUILT_IN_FIELDS.map((field): [BuiltInField, BuiltInValues] => {
    const { isEnabled, options } = config[field];
    const choices = (options ?? []).map((option) => ({
      key: option.key,
      labels: Object.fromEntries(locales.map((locale) => [locale, option.label[locale] ?? ''])),
    }));
    return [field, { isEnabled, hasChoices: options !== null, choices }];
  });
  return Object.fromEntries(entries) as RsvpFieldsValues;
}

/** A host's question: one row per choice, holding that choice's label in each language. */
export interface QuestionValues {
  type: QuestionType;
  required: boolean;
  prompt: Record<string, string>;
  choices: Array<Record<string, string>>;
}

/** A new question starts as one line of text, optional, with two empty choices ready. */
export function newQuestionValues(locales: readonly string[]): QuestionValues {
  const empty = () => Object.fromEntries(locales.map((locale) => [locale, '']));
  return { type: 'TEXT', required: false, prompt: empty(), choices: [empty(), empty()] };
}

export function questionFormValues(question: Question, locales: readonly string[]): QuestionValues {
  const count = Math.max(0, ...locales.map((locale) => question.options[locale]?.length ?? 0));
  const choices = Array.from({ length: count }, (_, position) =>
    Object.fromEntries(
      locales.map((locale) => [locale, question.options[locale]?.[position] ?? '']),
    ),
  );
  return {
    type: question.type,
    required: question.required,
    prompt: Object.fromEntries(locales.map((locale) => [locale, question.prompt[locale] ?? ''])),
    choices,
  };
}

export const CHOICE_TYPES: readonly QuestionType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE'];

export function takesChoices(type: QuestionType): boolean {
  return CHOICE_TYPES.includes(type);
}
