import { z } from 'zod';

import { isAnswerable, type Asking } from './asking';
import type { AnswerFormValues } from './form-model';
import type { AttendanceMode } from './types';

/** Messages are codes, worded by the page. The backend's own limits (`HostRsvpDto`, `answers.ts`). */
export type AnswerFieldCode = 'chooseAnswer' | 'chooseVenue' | 'tooLong';

const LIMITS = {
  dietaryText: 40,
  dietaryNotes: 500,
  drinkPreference: 80,
  songRequest: 200,
  message: 1000,
} as const;

const ANSWER_LIMITS: Readonly<Record<string, number>> = { TEXT: 500, LONG_TEXT: 4000 };

interface Issue {
  path: PropertyKey[];
  message: AnswerFieldCode;
}

function attendanceIssues(mode: AttendanceMode, values: AnswerFormValues): Issue[] {
  if (mode === 'EVENT_WIDE') {
    return values.status ? [] : [{ path: ['status'], message: 'chooseAnswer' }];
  }
  const isAnyGiven = Object.values(values.venues).some((reply) => reply !== '');
  return isAnyGiven ? [] : [{ path: ['venues'], message: 'chooseVenue' }];
}

function lengthIssues(asking: Asking, values: AnswerFormValues): Issue[] {
  const fields = (Object.keys(LIMITS) as Array<keyof typeof LIMITS>).filter(
    (field) => values[field].trim().length > LIMITS[field],
  );
  const answers = asking.questions.filter((question) => {
    const limit = ANSWER_LIMITS[question.type];
    const answer = values.answers[question.id];
    return (
      isAnswerable(question) && limit && typeof answer === 'string' && answer.trim().length > limit
    );
  });
  return [
    ...fields.map((field): Issue => ({ path: [field], message: 'tooLong' })),
    ...answers.map((question): Issue => ({ path: ['answers', question.id], message: 'tooLong' })),
  ];
}

/**
 * The checks a recorded answer gets before it is sent. Required questions are not among them: the
 * host may not know the meal yet, and the backend doesn't require them here (docs/API.md §6).
 */
export function answerFormSchema(mode: AttendanceMode, asking: Asking) {
  return z.custom<AnswerFormValues>().superRefine((values, ctx) => {
    for (const issue of [...attendanceIssues(mode, values), ...lengthIssues(asking, values)]) {
      ctx.addIssue({ code: 'custom', ...issue });
    }
  });
}
