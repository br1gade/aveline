import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { AppForm, ProblemAlert, SubmitButton } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import { addGuest, updateGuest } from '../api';
import { guestFormValues, newGuestValues, toGuestFormInput } from '../form-model';
import { addPayload, guestUpdatePayload } from '../payload';
import { badRequestMessages, refusalOf, useRefusedText, type Refusal } from '../refusals';
import { guestFormSchema, type GuestFormInput, type GuestFormValues } from '../schemas';
import { refusedGuestFields } from '../server-errors';
import type { Household } from '../types';
import type { DialogTarget } from './dialog-target';
import { GuestFields, type GuestForm, type GuestOptions } from './guest-fields';
import { useGuestOptions } from './use-guest-options';
import type { DialogHostActions } from './use-list-dialogs';

type GuestTarget = Extract<DialogTarget, { kind: 'add' | 'edit' }>;

interface SaveInput {
  eventId: string;
  target: GuestTarget;
  values: GuestFormValues;
  options: GuestOptions;
  t: TFunction<'guests'>;
}

/** Sends the guest, and says what happened; `null` when an edit changed nothing, so sent nothing. */
async function saveGuest({
  eventId,
  target,
  values,
  options,
  t,
}: SaveInput): Promise<string | null> {
  const { api } = browserSession();
  if (target.kind === 'add') {
    await addGuest(api, eventId, addPayload(values, options.isContactShown));
    return t('status.added', {
      name: [values.firstName, values.lastName].filter(Boolean).join(' '),
    });
  }
  // The baseline is the guest as the dialog first showed them, as the event form's is.
  const body = guestUpdatePayload(
    guestFormValues(target.guest, target.household.id),
    values,
    target.guest.contact,
  );
  if (Object.keys(body).length === 0) return null;
  await updateGuest(api, eventId, target.guest.id, body);
  return t('status.saved', { name: target.guest.name });
}

interface SubmitInput {
  eventId: string;
  target: GuestTarget;
  form: GuestForm;
  options: GuestOptions;
  host: DialogHostActions;
}

/** A 400 goes under the fields it names; a list out of date reloads behind the message. */
function useGuestSubmit({ eventId, target, form, options, host }: SubmitInput) {
  const { t } = useTranslation('guests');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const submit = async (values: GuestFormValues) => {
    setRefusal(null);
    try {
      await host.saved(await saveGuest({ eventId, target, values, options, t }));
    } catch (error) {
      const marked = refusedGuestFields(badRequestMessages(error));
      for (const { field, code } of marked) form.setError(field, { type: 'server', message: code });
      const found = refusalOf(error, target.kind, marked.length);
      setRefusal(found);
      if (found.isListStale) host.reload();
    }
  };
  return { submit, refusal };
}

interface GuestDialogProps {
  event: EventDetail;
  households: readonly Household[];
  target: GuestTarget;
  isListContactShown: boolean;
  host: DialogHostActions;
}

/** Adding a guest, or correcting one (design PD-44). An edit sends only what changed. */
export function GuestDialog({
  event,
  households,
  target,
  isListContactShown,
  host,
}: GuestDialogProps) {
  const { t } = useTranslation('guests');
  const options = useGuestOptions({ event, households, target, isListContactShown });
  const [defaults] = useState<GuestFormInput>(() =>
    target.kind === 'add'
      ? newGuestValues(target.householdId)
      : toGuestFormInput(guestFormValues(target.guest, target.household.id)),
  );
  const form = useForm<GuestFormInput, unknown, GuestFormValues>({
    resolver: zodResolver(guestFormSchema),
    defaultValues: defaults,
  });
  const { submit, refusal } = useGuestSubmit({ eventId: event.id, target, form, options, host });
  const refused = useRefusedText(target.kind, refusal?.isOnFields ?? false);
  const { isSubmitting } = form.formState;
  const isAdding = target.kind === 'add';
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[30rem]"
        onCloseAutoFocus={host.restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {isAdding ? t('dialog.addTitle') : t('dialog.editTitle', { name: target.guest.name })}
          </DialogTitle>
        </DialogHeader>
        {refusal ? <ProblemAlert problem={refusal.problem} refused={refused} /> : null}
        <AppForm onSubmit={form.handleSubmit(submit)}>
          <GuestFields form={form} options={options} mode={target.kind} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('dialog.cancel')}
              </Button>
            </DialogClose>
            <SubmitButton isSubmitting={isSubmitting} className="w-auto">
              {isSubmitting
                ? t(isAdding ? 'dialog.adding' : 'dialog.saving')
                : t(isAdding ? 'dialog.addSubmit' : 'dialog.editSubmit')}
            </SubmitButton>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
