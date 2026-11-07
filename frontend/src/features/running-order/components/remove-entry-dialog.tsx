import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AskFirstDialog, type DialogContext } from '@/ui/app-form';

import { removeEntry } from '../api';
import { venuesHiddenBy } from '../order';
import type { OrderVenue, TimelineEntry } from '../types';
import { EntryProblem, HiddenVenues, useEntryAction } from './shared';

interface RemoveEntryDialogProps extends DialogContext {
  eventId: string;
  venues: readonly OrderVenue[];
  entries: readonly TimelineEntry[];
  entry: TimelineEntry;
  name: string;
}

/** Removing asks first: it leaves the invitation and the vendors' brief at once. */
export function RemoveEntryDialog({
  eventId,
  venues,
  entries,
  entry,
  name,
  ...context
}: RemoveEntryDialogProps) {
  const { t } = useTranslation('running-order');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useEntryAction(context);
  const hidden = venuesHiddenBy(venues, entries, { kind: 'remove', id: entry.id });
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('remove.title', { name })}
      body={t('remove.body')}
      confirmLabel={t('remove.confirm')}
      isBusy={isBusy}
      problem={refusal ? <EntryProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          () => removeEntry(browserSession().api, eventId, entry.id),
          t('status.removed', { name }),
        )
      }
    >
      <HiddenVenues names={hidden.map((venue) => venue.name)} />
    </AskFirstDialog>
  );
}
