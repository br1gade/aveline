import { QuestionType, RsvpStatus } from '@prisma/client';

/**
 * What a guest may answer to a host's own questions.
 *
 * A choice is answered by its position in the option list, not its text. The
 * options are translated, and the page sends each guest the list in their own
 * language — so "Fish", "Рыба" and "Ձուկ" are the same answer, and the host's
 * count of who chose fish must not split three ways. Position is the same in
 * every language.
 */
export interface AnswerableQuestion {
  id: string;
  type: QuestionType;
  required: boolean;
  options: unknown;
}

export interface Answer {
  questionId: string;
  value: unknown;
}

const TEXT_LIMITS: Partial<Record<QuestionType, number>> = {
  [QuestionType.TEXT]: 500,
  [QuestionType.LONG_TEXT]: 4000,
};

/** The first problem with these answers, phrased for the guest's form — or null. */
export function answersProblem(questions: AnswerableQuestion[], answers: Answer[]): string | null {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set<string>();

  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) return `answers: ${answer.questionId} is not a question on this invitation`;
    if (seen.has(answer.questionId)) return `answers: ${answer.questionId} is answered twice`;
    seen.add(answer.questionId);

    const problem = valueProblem(question, answer.value);
    if (problem) return `answers: ${answer.questionId} ${problem}`;
  }
  return null;
}

/**
 * A required question nobody has answered yet, for a guest who is coming.
 *
 * Only for someone attending: a guest who declines should not have to choose
 * a meal. Answers from an earlier submission count — editing an answer is not
 * answering everything again.
 */
export function unansweredRequired(
  questions: AnswerableQuestion[],
  answeredIds: ReadonlySet<string>,
  status: RsvpStatus,
): AnswerableQuestion | undefined {
  if (status !== RsvpStatus.ATTENDING) return undefined;
  return questions.find((question) => question.required && !answeredIds.has(question.id));
}

function valueProblem(question: AnswerableQuestion, value: unknown): string | null {
  switch (question.type) {
    case QuestionType.TEXT:
    case QuestionType.LONG_TEXT:
      return textProblem(value, TEXT_LIMITS[question.type] ?? 500);
    case QuestionType.BOOLEAN:
      return typeof value === 'boolean' ? null : 'must be true or false';
    case QuestionType.SINGLE_CHOICE:
      return isChoice(value, optionCount(question.options)) ? null : 'must be the position of one of its options';
    case QuestionType.MULTI_CHOICE:
      return choicesProblem(value, optionCount(question.options));
    default:
      return 'cannot be answered here yet';
  }
}

function textProblem(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return 'must be text';
  return value.length > limit ? `must be at most ${limit} characters` : null;
}

function choicesProblem(value: unknown, count: number): string | null {
  if (!Array.isArray(value) || !value.every((choice) => isChoice(choice, count))) {
    return 'must be a list of positions of its options';
  }
  return new Set(value).size === value.length ? null : 'must not choose the same option twice';
}

function isChoice(value: unknown, count: number): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < count;
}

/**
 * How many options every language has. The shortest list, so an answer is a
 * real option whichever language the guest read it in.
 */
function optionCount(options: unknown): number {
  if (!options || typeof options !== 'object') return 0;
  const lists = Object.values(options as Record<string, unknown>).filter(Array.isArray);
  return lists.length === 0 ? 0 : Math.min(...lists.map((list) => list.length));
}
