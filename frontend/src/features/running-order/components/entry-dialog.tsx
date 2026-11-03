import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { AppForm, SubmitButton, WRAPPING_BUTTON, type DialogContext } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/kit/dialog';

import { addEntry, updateEntry } from '../api';
import { entryFormValues, entryLanguages, newEntryValues } from '../form-model';
import { venuesHiddenBy } from '../order';
import { entryUpdatePayload, newEntryPayload } from '../payload';
import { labelIn } from '../read';
import { entryFormSchema, type EntryFormValues } from '../schemas';
import type { OrderVenue, TimelineEntry } from '../types';
import { EntryFields, type EntryForm } from './entry-fields';
import { EntryProblem, HiddenVenues, useEntryAction } from './shared';

interface EntryDialogProps extends DialogContext {
  event: EventDetail;
  venues: readonly OrderVenue[];
  entries: readonly TimelineEntry[];
  /** The entry being corrected; none when adding. */
  entry?: TimelineEntry | undefined;
}

/** The venues guests would stop seeing if the form were saved as it stands. */
function useHiddenNames(form: EntryForm, props: EntryDialogProps): string[] {
  const venueId = useWatch({ control: form.control, name: 'venueId' });
  const isInternal = useWatch({ control: form.control, name: 'isInternal' });
  const change = {
    kind: 'save',
    id: props.entry?.id,
    venueId: venueId || null,
    isInternal,
  } as const;
  return venuesHiddenBy(props.venues, props.entries, change).map((venue) => venue.name);
}

/** Sends the entry. An edit that changed nothing closes without a request. */
function useSaveEntry(props: EntryDialogProps, initial: EntryFormValues) {
  const { t } = useTranslation('running-order');
  const { event, entries, entry } = props;
  const action = useEntryAction(props);
  const context = { timeZone: event.timezone, entries };
  const save = async (values: EntryFormValues) => {
    const { api } = browserSession();
    const name = labelIn(values.labels, event.defaultLocale)?.text ?? '';
    if (!entry) {
      const body = newEntryPayload(values, event.timezone, entries);
      return action.run(() => addEntry(api, event.id, body), t('status.added', { name }));
    }
    const body = entryUpdatePayload(entry, initial, values, context);
    if (Object.keys(body).length === 0) return props.onClose();
    return action.run(
      () => updateEntry(api, event.id, entry.id, body),
      t('status.saved', { name }),
    );
  };
  return { ...action, save };
}

/**
 * Adding an entry to the running order, or correcting one (design PD-106, PD-107). It warns before
 * a save that would take a venue away from guests, which the backend refuses once guests answered
 * for it or sit there.
 */
export function EntryDialog(props: EntryDialogProps) {
  const { t } = useTranslation('running-order');
  const { event, venues, entry } = props;
  const [languages] = useState(() => entryLanguages(event.locales, entry));
  const [initial] = useState(() =>
    entry
      ? entryFormValues(entry, languages, event.timezone)
      : newEntryValues(languages, event.startsAt, event.timezone),
  );
  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema(event.timezone)),
    defaultValues: initial,
  });
  const { isBusy, refusal, save, onCloseAutoFocus, onOpenChange } = useSaveEntry(props, initial);
  const hidden = useHiddenNames(form, props);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[30rem]"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{entry ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
        </DialogHeader>
        {refusal ? <EntryProblem refusal={refusal} /> : null}
        <AppForm onSubmit={form.handleSubmit(save)}>
          <EntryFields
            form={form}
            languages={languages}
            venues={venues}
            timeZone={event.timezone}
          />
          <HiddenVenues names={hidden} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className={WRAPPING_BUTTON}
              disabled={isBusy}
              onClick={props.onClose}
            >
              {t('dialog.cancel')}
            </Button>
            <SubmitButton isSubmitting={isBusy} className={`w-auto ${WRAPPING_BUTTON}`}>
              {isBusy ? t('dialog.saving') : t(entry ? 'dialog.save' : 'dialog.add')}
            </SubmitButton>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
