import { QuestionType, RsvpStatus } from '@prisma/client';
import { resolveTranslation } from '../../common/locale';

/**
 * Answers to a host's own questions, as a host reads them.
 *
 * Answers are stored by position (see `answers.ts`), which is right for
 * counting and useless on a sheet: a caterer reads "Fish", not "1". These
 * turn positions back into the option's words in one language, and count
 * them.
 */
export interface DisplayableQuestion {
  type: QuestionType;
  options: unknown;
}

export interface Response {
  status: RsvpStatus;
  value: unknown;
}

const YES_NO = ['Yes', 'No'] as const;

/** The option list in one language, falling back to the event's default. */
export function optionLabels(options: unknown, locale: string, defaultLocale: string): string[] {
  const resolved = resolveTranslation<unknown>(options, locale, defaultLocale);
  return Array.isArray(resolved) ? resolved.map(String) : [];
}

/** One answer as words. */
export function formatAnswer(question: DisplayableQuestion, value: unknown, labels: string[]): string {
  if (question.type === QuestionType.BOOLEAN) return value === true ? YES_NO[0] : YES_NO[1];
  if (question.type === QuestionType.SINGLE_CHOICE) return labelAt(labels, value);
  if (question.type === QuestionType.MULTI_CHOICE && Array.isArray(value)) {
    return value.map((position) => labelAt(labels, position)).join('; ');
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * How many chose each option — among those coming, and among everyone who
 * answered. A caterer orders for the first; a host curious about the second.
 * Null for free text, which has nothing to count.
 */
export function tallyAnswers(question: DisplayableQuestion, responses: Response[], labels: string[]) {
  const choices = choicesOf(question, labels);
  if (!choices) return null;

  return choices.map(({ label, matches }) => ({
    option: label,
    attending: responses.filter((r) => r.status === RsvpStatus.ATTENDING && matches(r.value)).length,
    total: responses.filter((r) => matches(r.value)).length,
  }));
}

function choicesOf(question: DisplayableQuestion, labels: string[]) {
  switch (question.type) {
    case QuestionType.BOOLEAN:
      return [
        { label: YES_NO[0], matches: (value: unknown) => value === true },
        { label: YES_NO[1], matches: (value: unknown) => value === false },
      ];
    case QuestionType.SINGLE_CHOICE:
      return labels.map((label, position) => ({ label, matches: (value: unknown) => value === position }));
    case QuestionType.MULTI_CHOICE:
      return labels.map((label, position) => ({
        label,
        matches: (value: unknown) => Array.isArray(value) && value.includes(position),
      }));
    default:
      return null;
  }
}

function labelAt(labels: string[], position: unknown): string {
  return typeof position === 'number' ? (labels[position] ?? `#${position}`) : String(position);
}
