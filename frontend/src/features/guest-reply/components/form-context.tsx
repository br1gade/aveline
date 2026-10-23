import { createContext, useContext } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import type { Invitation } from '@/features/invitation-renderer';

import type { ReplyFormValues } from '../form-model';
import type { FieldProblem } from '../server-errors';
import type { ReplyRecord } from '../types';

/** What every section needs besides the form: the invitation, the saved reply, refused fields. */
export interface ReplyFormContextValue {
  invitation: Invitation;
  record: ReplyRecord;
  serverProblems: readonly FieldProblem[];
  errorText: (code: string) => string;
}

const ReplyContext = createContext<ReplyFormContextValue | null>(null);

export const ReplyFormProvider = ReplyContext.Provider;

export function useReplyForm() {
  const reply = useContext(ReplyContext);
  if (!reply) {
    throw new Error('useReplyForm must be used inside ReplyForm');
  }
  const form = useFormContext<ReplyFormValues>();
  const status = useWatch({ control: form.control, name: 'status' });
  return { ...reply, form, status };
}

/** A field's message: the form's own check first, else what the server refused. */
export function useFieldError(path: string, message: string | undefined): string | undefined {
  const { serverProblems, errorText } = useReplyForm();
  const code = message ?? serverProblems.find((problem) => problem.field === path)?.code;
  return code ? errorText(code) : undefined;
}
