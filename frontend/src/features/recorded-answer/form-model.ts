import type { AskedField, AskedQuestion, Asking } from './asking';
import { isAnswerable } from './asking';
import type { AnsweringGuest, Reply } from './types';

/** An answer as a form holds it: text, `yes`/`no`, a choice's position, or several. */
export type FormAnswer = string | string[];

export interface AnswerFormValues {
  /** The event-wide answer; empty until chosen. */
  status: Reply | '';
  /** In PER_VENUE, each venue's answer by its id; empty where none is given. */
  venues: Record<string, Reply | ''>;
  /** Chosen keys, when the invitation gives dietary choices. */
  dietary: string[];
  /** Free text, when it gives none. */
  dietaryText: string;
  dietaryNotes: string;
  drinkPreference: string;
  songRequest: string;
  message: string;
  answers: Record<string, FormAnswer>;
  notifyGuest: boolean;
}

function yesOrNo(value: unknown): FormAnswer {
  if (typeof value !== 'boolean') return '';
  return value ? 'yes' : 'no';
}

function formAnswer(question: AskedQuestion, value: unknown): FormAnswer {
  switch (question.type) {
    case 'BOOLEAN':
      return yesOrNo(value);
    case 'SINGLE_CHOICE':
      return typeof value === 'number' ? String(value) : '';
    case 'MULTI_CHOICE':
      return Array.isArray(value) ? value.filter((one) => typeof one === 'number').map(String) : [];
    default:
      return typeof value === 'string' ? value : '';
  }
}

function hasChoices(fields: readonly AskedField[], field: AskedField['field']): boolean {
  return fields.some((asked) => asked.field === field && asked.options !== null);
}

/** The guest's answer so far, as the form shows it. */
export function answerFormValues(guest: AnsweringGuest, asking: Asking): AnswerFormValues {
  const isDietaryChosen = hasChoices(asking.fields, 'dietary');
  return {
    status: guest.reply ?? '',
    venues: Object.fromEntries(guest.venues.map((venue) => [venue.venueId, venue.reply ?? ''])),
    dietary: isDietaryChosen ? [...guest.dietary] : [],
    dietaryText: isDietaryChosen ? '' : guest.dietary.join(', '),
    dietaryNotes: guest.dietaryNotes,
    drinkPreference: guest.drinkPreference,
    songRequest: guest.songRequest,
    message: guest.message,
    answers: Object.fromEntries(
      asking.questions
        .filter(isAnswerable)
        .map((question) => [question.id, formAnswer(question, guest.answers[question.id])]),
    ),
    notifyGuest: false,
  };
}
