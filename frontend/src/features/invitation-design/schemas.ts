import { z } from 'zod';

import type { BlockEditing } from '@/features/invitation-renderer';
import { safeExternalUrl } from '@/lib/links';

import {
  takesChoices,
  type BuiltInValues,
  type QuestionValues,
  type RsvpFieldsValues,
  type SectionFormValues,
} from './form-model';
import { choiceLists } from './payload';

/**
 * The design forms' checks, made before anything is sent. The server stays the authority; these
 * are its own rules where the guide states them (docs/API.md §6), so a host meets them at once.
 * Each error is a code that `use-field-text.ts` words.
 */
export type DesignFieldCode =
  | 'url'
  | 'colour'
  | 'noPrompt'
  | 'noChoices'
  | 'halfFilled'
  | 'noLabel'
  | 'labelTooLong'
  | 'tooManyChoices'
  | 'altTooLong'
  | 'refused';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

const copySchema = z.object({
  fields: z.record(z.string(), z.string()),
  items: z.array(z.record(z.string(), z.string())),
});

/** A web link must be http or https, or the guest page drops it (`safeExternalUrl`). */
export function sectionFormSchema(editing: BlockEditing) {
  const links = editing.fields.filter((field) => field.kind === 'url').map((field) => field.name);
  return z
    .object({
      variant: z.string(),
      copy: z.record(z.string(), copySchema),
      colours: z.array(z.string()),
      assetIds: z.array(z.string()),
    })
    .superRefine((values: SectionFormValues, context) => {
      for (const [locale, copy] of Object.entries(values.copy)) {
        for (const name of links) {
          const value = (copy.fields[name] ?? '').trim();
          if (value && !safeExternalUrl(value)) {
            context.addIssue({
              code: 'custom',
              path: ['copy', locale, 'fields', name],
              message: 'url',
            });
          }
        }
      }
      values.colours.forEach((colour, position) => {
        if (!HEX_COLOUR.test(colour)) {
          context.addIssue({ code: 'custom', path: ['colours', position], message: 'colour' });
        }
      });
    });
}

const LABEL_LIMIT = 80;
const CHOICE_LIMIT = 30;

const builtInSchema = z.object({
  isEnabled: z.boolean(),
  hasChoices: z.boolean(),
  choices: z.array(z.object({ key: z.string(), labels: z.record(z.string(), z.string()) })),
});

/** Fixed choices: 1 to 30, each with a label in at least one language, 80 characters at most. */
function checkChoices(field: string, value: BuiltInValues, context: z.RefinementCtx) {
  if (!value.hasChoices) return;
  if (value.choices.length === 0) {
    context.addIssue({ code: 'custom', path: [field, 'choices'], message: 'noChoices' });
  }
  if (value.choices.length > CHOICE_LIMIT) {
    context.addIssue({ code: 'custom', path: [field, 'choices'], message: 'tooManyChoices' });
  }
  value.choices.forEach((choice, position) => {
    const labels = Object.values(choice.labels).map((label) => label.trim());
    const path = [field, 'choices', position, 'labels'];
    if (!labels.some(Boolean)) context.addIssue({ code: 'custom', path, message: 'noLabel' });
    if (labels.some((label) => label.length > LABEL_LIMIT)) {
      context.addIssue({ code: 'custom', path, message: 'labelTooLong' });
    }
  });
}

export const rsvpFieldsSchema = z
  .object({
    dietary: builtInSchema,
    drinkPreference: builtInSchema,
    songRequest: builtInSchema,
    message: builtInSchema,
    attribution: builtInSchema,
  })
  .superRefine((values: RsvpFieldsValues, context) => {
    for (const [field, value] of Object.entries(values)) checkChoices(field, value, context);
  });

/**
 * A question needs its wording in at least one language; a choice question needs choices, and
 * every language it is given in must name every choice, since an answer is a position.
 */
export function questionSchema(locales: readonly string[]) {
  return z
    .object({
      type: z.enum(['TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'BOOLEAN', 'SIGNATURE']),
      required: z.boolean(),
      prompt: z.record(z.string(), z.string()),
      choices: z.array(z.record(z.string(), z.string())),
    })
    .superRefine((values: QuestionValues, context) => {
      if (!Object.values(values.prompt).some((text) => text.trim())) {
        context.addIssue({ code: 'custom', path: ['prompt'], message: 'noPrompt' });
      }
      if (!takesChoices(values.type)) return;
      const { lists, halfFilled } = choiceLists(values.choices, locales);
      if (values.choices.length === 0 || Object.keys(lists).length === 0) {
        context.addIssue({ code: 'custom', path: ['choices'], message: 'noChoices' });
      }
      // Which languages, the form works out itself from the same rule (`choiceLists`).
      if (halfFilled.length > 0) {
        context.addIssue({ code: 'custom', path: ['choices'], message: 'halfFilled' });
      }
    });
}

const ALT_LIMIT = 300;

export const altTextSchema = z.record(z.string(), z.string().max(ALT_LIMIT, 'altTooLong'));
