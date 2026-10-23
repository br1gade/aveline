import { createContext, useContext } from 'react';
import { get, useFormContext, useWatch, type FieldError } from 'react-hook-form';

import type { BuiltInField, Invitation, RsvpFieldConfig } from '@/features/invitation-renderer';

import type { ReplyFormValues } from '../form-model';
import { fieldConfig } from '../options';
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
  const field = (name: BuiltInField): RsvpFieldConfig => fieldConfig(reply.invitation, name);
  return { ...reply, form, status, field };
}

/** A field's message by its form path: the form's own check first, else the server's refusal. */
export function useFieldError(path: string): string | undefined {
  const { form, serverProblems, errorText } = useReplyForm();
  const own = get(form.formState.errors, path) as FieldError | undefined;
  const code = own?.message ?? serverProblems.find((problem) => problem.field === path)?.code;
  return code ? errorText(code) : undefined;
}
