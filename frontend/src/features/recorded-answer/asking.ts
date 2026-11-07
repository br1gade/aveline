import type { Design } from '@/features/invitation-design';
import { wordsIn } from '@/lib/i18n';
import type { QuestionType } from '@/features/invitation-renderer';

/** The built-in questions a host can record; whose side someone is on is set on the guest. */
export const HOST_FIELDS = ['dietary', 'drinkPreference', 'songRequest', 'message'] as const;
export type HostField = (typeof HOST_FIELDS)[number];

/** Words in one language, and which: the host reads them in the event's default, else the first. */
export interface Worded {
  text: string;
  language: string | undefined;
}

export interface AskedQuestion {
  id: string;
  type: QuestionType;
  /** The guest's page requires it of someone coming; recording leaves it for later. */
  isRequired: boolean;
  prompt: Worded;
  /** A choice is sent as its position in this list. */
  options: string[];
  /** The language the choices are in, which may not be the prompt's. */
  optionsLanguage: string | undefined;
}

export interface AskedField {
  field: HostField;
  /** Fixed choices, each sent as its key; `null` is free text. */
  options: Array<{ key: string; label: Worded }> | null;
}

/** What the invitation asks: its own questions in the host's order, and the built-ins switched on. */
export interface Asking {
  questions: AskedQuestion[];
  fields: AskedField[];
}

export const NOTHING_ASKED: Asking = { questions: [], fields: [] };

function wordedIn(copy: Readonly<Record<string, string>>, language: string): Worded {
  return wordsIn(copy, language) ?? { text: '', language: undefined };
}

/**
 * The choices in one language, else the first that has some, cut to the shortest language's list:
 * the backend takes a position only below it (`answers.ts`, `optionCount`).
 */
function optionsIn(
  options: Readonly<Record<string, readonly string[]>>,
  language: string,
): { options: string[]; language: string | undefined } {
  const lists = Object.entries(options).filter(([, list]) => list.length > 0);
  const chosen = lists.find(([code]) => code === language) ?? lists[0];
  if (!chosen) return { options: [], language: undefined };
  const count = Math.min(...Object.values(options).map((list) => list.length));
  return { options: chosen[1].slice(0, count), language: chosen[0] };
}

/** The invitation's questions as the host reads them, in the event's default language. */
export function askingOf(
  design: Pick<Design, 'questions' | 'rsvpFields'>,
  language: string,
): Asking {
  return {
    questions: design.questions.map((question) => {
      const choices = optionsIn(question.options, language);
      return {
        id: question.id,
        type: question.type,
        isRequired: question.required,
        prompt: wordedIn(question.prompt, language),
        options: choices.options,
        optionsLanguage: choices.language,
      };
    }),
    fields: HOST_FIELDS.filter((field) => design.rsvpFields[field].isEnabled).map((field) => ({
      field,
      options:
        design.rsvpFields[field].options?.map((option) => ({
          key: option.key,
          label: wordedIn(option.label, language),
        })) ?? null,
    })),
  };
}

/**
 * A question a host can answer. Agreeing to a statement needs the guest's own link, and the backend
 * refuses one recorded for them (`acknowledgement-writes.ts`), so it is shown, never sent.
 */
export function isAnswerable(question: AskedQuestion): boolean {
  return question.type !== 'SIGNATURE';
}
