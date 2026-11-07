import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { ProblemAlert } from '@/ui/app-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/kit/alert-dialog';
import { Button } from '@/ui/kit/button';

import { removeGuest } from '../api';
import { refusalOf, useRefusedText, type Refusal } from '../refusals';
import type { Guest, Household } from '../types';
import type { DialogHostActions } from './use-list-dialogs';

interface RemoveProps {
  eventId: string;
  guest: Guest;
  household: Household;
  host: DialogHostActions;
}

/** What goes with them: their answer and seat, the household if nobody is left, the invitation's holder. */
function Consequences({ guest, household }: Pick<RemoveProps, 'guest' | 'household'>) {
  const { t } = useTranslation('guests');
  const isLast = household.guests.length <= 1;
  return (
    <>
      <AlertDialogDescription>{t('remove.body')}</AlertDialogDescription>
      {isLast ? (
        <p className="text-muted-foreground m-0 text-sm">
          {t('remove.lastInHousehold', { household: household.name })}
        </p>
      ) : null}
      {!isLast && guest.isPrimary ? (
        <p className="text-muted-foreground m-0 text-sm">{t('remove.handOver')}</p>
      ) : null}
    </>
  );
}

/** A checked-in guest is the record that they came: there is nothing to confirm, only why. */
function CheckedIn({ guest }: { guest: Guest }) {
  const { t } = useTranslation('guests');
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('remove.checkedInTitle', { name: guest.name })}</AlertDialogTitle>
        <AlertDialogDescription>{t('remove.checkedInBody')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('remove.close')}</AlertDialogCancel>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Removing a guest, after a confirmation (design PD-44). The press is a plain button, not the
 * dialog's own action, so the dialog stays open while the request runs and can show a refusal.
 */
export function RemoveGuestDialog({ eventId, guest, household, host }: RemoveProps) {
  const { t } = useTranslation('guests');
  const [isRemoving, setIsRemoving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const refused = useRefusedText('remove', false);

  const confirm = async () => {
    setRefusal(null);
    setIsRemoving(true);
    try {
      const { isHouseholdRemoved } = await removeGuest(browserSession().api, eventId, guest.id);
      const key = isHouseholdRemoved ? 'status.removedWithHousehold' : 'status.removed';
      await host.saved(t(key, { name: guest.name }));
    } catch (error) {
      const found = refusalOf(error, 'remove');
      setRefusal(found);
      setIsRemoving(false);
      if (found.isListStale) host.reload();
    }
  };

  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <AlertDialogContent onCloseAutoFocus={host.restoreFocus}>
        {guest.isCheckedIn ? (
          <CheckedIn guest={guest} />
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('remove.title', { name: guest.name })}</AlertDialogTitle>
              <Consequences guest={guest} household={household} />
            </AlertDialogHeader>
            {refusal ? (
              <ProblemAlert
                problem={refusal.problem}
                refused={(status) => refused(status, refusal.messages)}
              />
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>{t('remove.cancel')}</AlertDialogCancel>
              <Button variant="destructive" disabled={isRemoving} onClick={() => void confirm()}>
                {isRemoving ? t('remove.removing') : t('remove.confirm')}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
