import { createContext, useContext } from 'react';
import { get, useFormContext, useWatch, type FieldError } from 'react-hook-form';

import type { BuiltInField, Invitation, RsvpFieldConfig } from '@/features/invitation-renderer';

import { respondentStatus, type VenueChoice } from '../attendance';
import type { ReplyFormValues } from '../form-model';
import { fieldConfig } from '../options';
import type { FieldProblem } from '../server-errors';
import type { SignatureContext } from '../signatures';
import type { ReplyRecord } from '../types';

/** Saving a drawn signature (docs/API.md §11), done by the page that holds the guest's link. */
export interface SigningActions {
  /**
   * Uploads a drawing and waits until the backend has checked it: its id once READY, `null` when
   * it failed or took too long. `onStaged` says the upload arrived and the check began.
   */
  upload: (drawing: Blob, signal: AbortSignal, onStaged: () => void) => Promise<string | null>;
  /** Best effort: an unused drawing the guest replaced. */
  remove: (assetId: string) => void;
}

/** What every section needs besides the form: the invitation, the saved reply, refused fields. */
export interface ReplyFormContextValue {
  invitation: Invitation;
  record: ReplyRecord;
  /** The venues answered one by one in PER_VENUE; empty for one answer for the event. */
  venues: readonly VenueChoice[];
  /** The statements to agree to; `null` when the invitation has none. */
  signatures: SignatureContext | null;
  signing: SigningActions;
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
  const [chosen, venues] = useWatch({ control: form.control, name: ['status', 'venues'] });
  const venueIds = reply.venues.map((venue) => venue.venueId);
  // The respondent's answer: chosen, or in PER_VENUE the summary of their venues.
  const status = respondentStatus({ status: chosen, venues }, venueIds);
  const field = (name: BuiltInField): RsvpFieldConfig => fieldConfig(reply.invitation, name);
  return { ...reply, form, status, venueIds, field };
}

/** A field's message by its form path: the form's own check first, else the server's refusal. */
export function useFieldError(path: string): string | undefined {
  const { form, serverProblems, errorText } = useReplyForm();
  const own = get(form.formState.errors, path) as FieldError | undefined;
  const code = own?.message ?? serverProblems.find((problem) => problem.field === path)?.code;
  return code ? errorText(code) : undefined;
}
