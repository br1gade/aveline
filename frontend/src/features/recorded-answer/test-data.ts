import type { Design } from '@/features/invitation-design';

import { askingOf, type Asking } from './asking';
import type { GuestAnswerWire } from './types';

/** Fixtures for recording an answer: an invitation that asks a little of everything. */
const OFF = { isEnabled: false, options: null };

export const DESIGN: Pick<Design, 'questions' | 'rsvpFields'> = {
  questions: [
    {
      id: 'q-meal',
      type: 'SINGLE_CHOICE',
      required: true,
      prompt: { hy: 'Ճաշ', en: 'Meal' },
      options: { hy: ['Միս', 'Ձուկ'], en: ['Meat', 'Fish'] },
      answerCount: 3,
      statementVersionId: null,
    },
    {
      id: 'q-car',
      type: 'BOOLEAN',
      required: false,
      prompt: { en: 'Do you need parking?' },
      options: {},
      answerCount: 0,
      statementVersionId: null,
    },
    {
      id: 'q-songs',
      type: 'MULTI_CHOICE',
      required: false,
      prompt: { en: 'Dances' },
      options: { en: ['Waltz', 'Kochari', 'Tango'] },
      answerCount: 0,
      statementVersionId: null,
    },
    {
      id: 'q-note',
      type: 'TEXT',
      required: false,
      prompt: { en: 'Anything else?' },
      options: {},
      answerCount: 0,
      statementVersionId: null,
    },
    {
      id: 'q-photos',
      type: 'SIGNATURE',
      required: true,
      prompt: { en: 'I agree to be photographed' },
      options: {},
      answerCount: 0,
      statementVersionId: 'sv1',
    },
  ],
  rsvpFields: {
    dietary: {
      isEnabled: true,
      options: [
        { key: 'vegetarian', label: { en: 'Vegetarian', hy: 'Բուսակեր' } },
        { key: 'halal', label: { en: 'Halal' } },
      ],
    },
    drinkPreference: { isEnabled: true, options: null },
    songRequest: OFF,
    message: { isEnabled: true, options: null },
    attribution: { isEnabled: true, options: null },
  },
};

export const ASKING: Asking = askingOf(DESIGN, 'en');

export function wire(overrides: Partial<GuestAnswerWire> = {}): GuestAnswerWire {
  return {
    id: 'g1',
    name: 'Armen Petrosyan',
    token: 'secret-token',
    email: 'armen@example.am',
    phone: '+37491000000',
    isAnonymized: false,
    attendance: { mode: 'EVENT_WIDE', revision: 1, status: 'ATTENDING', venues: [] },
    rsvpStatus: 'ATTENDING',
    rsvp: {
      status: 'ATTENDING',
      dietary: ['vegetarian'],
      dietaryNotes: null,
      drinkPreference: 'Wine',
      songRequest: null,
      message: null,
    },
    answers: [
      { questionId: 'q-meal', value: 1 },
      { questionId: 'q-photos', value: { acknowledgementId: 'a1' } },
    ],
    ...overrides,
  };
}

export const PER_VENUE = {
  mode: 'PER_VENUE' as const,
  revision: 3,
  status: 'PENDING',
  venues: [
    { venueId: 'church', venue: 'Saint Gayane', status: 'ATTENDING' },
    { venueId: 'hall', venue: 'The hall', status: 'PENDING' },
  ],
};
