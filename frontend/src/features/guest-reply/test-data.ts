import type { BuiltInField, RsvpFieldConfig, RsvpQuestion } from '@/features/invitation-renderer';

import type { PayloadContext } from './payload';
import type { ReplyRecord } from './types';

/** Fictional test data for the reply's logic. No real token appears (frontend/CLAUDE.md §10). */
export const QUESTIONS: RsvpQuestion[] = [
  {
    id: 'q-main',
    type: 'SINGLE_CHOICE',
    required: true,
    prompt: 'Main course',
    options: ['Beef', 'Fish'],
  },
  {
    id: 'q-multi',
    type: 'MULTI_CHOICE',
    required: false,
    prompt: 'Activities',
    options: ['Dance', 'Toast'],
  },
  { id: 'q-bus', type: 'BOOLEAN', required: false, prompt: 'Shuttle?', options: [] },
  { id: 'q-note', type: 'TEXT', required: false, prompt: 'Note', options: [] },
  { id: 'q-sign', type: 'SIGNATURE', required: true, prompt: 'Sign', options: [] },
];

export function recordWith(rsvp: Partial<ReplyRecord['rsvp']> = {}): ReplyRecord {
  return {
    guest: { id: 'g1', firstName: 'Armen', lastName: 'Petrosyan' },
    household: {
      name: 'Petrosyan family',
      seatsAllotted: 3,
      members: [
        {
          id: 'g2',
          firstName: 'Lusine',
          lastName: 'Petrosyan',
          addedByGuest: false,
          status: 'PENDING',
          dietary: [],
          dietaryNotes: null,
        },
      ],
    },
    rsvp: { status: 'PENDING', answers: [], ...rsvp },
  };
}

/** Every built-in question asked, as free text, unless a test says otherwise. */
export function contextWith(
  fields: Partial<Record<BuiltInField, RsvpFieldConfig>> = {},
  locale?: string,
): PayloadContext {
  return {
    questions: QUESTIONS,
    field: (name) => fields[name] ?? { isEnabled: true, options: null },
    locale,
  };
}
