import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
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

import { deleteTable } from '../api';
import { refusalOf, type SeatingRefusal } from '../refusals';
import type { SeatingTable } from '../types';
import { SeatingProblem } from './shared';
import type { SeatingHost } from './use-seating-host';

/** A table with guests is refused by the backend (409): there is nothing to confirm, only why. */
function Occupied({ table }: { table: SeatingTable }) {
  const { t } = useTranslation('seating');
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('remove.occupiedTitle', { name: table.name })}</AlertDialogTitle>
        <AlertDialogDescription>{t('remove.occupiedBody')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('remove.close')}</AlertDialogCancel>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Removing a table, after a confirmation (design PD-68). The press is a plain button, not the
 * dialog's own action, so the dialog stays open while the request runs and can show a refusal.
 */
export function RemoveTableDialog({ table, host }: { table: SeatingTable; host: SeatingHost }) {
  const { t } = useTranslation('seating');
  const [isRemoving, setIsRemoving] = useState(false);
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  const confirm = async () => {
    setRefusal(null);
    setIsRemoving(true);
    try {
      await deleteTable(browserSession().api, host.eventId, table.id);
      await host.saved(t('status.tableRemoved', { name: table.name }));
    } catch (error) {
      const found = refusalOf(error, 'removeTable');
      setRefusal(found);
      setIsRemoving(false);
      if (found.isStale) host.reload();
    }
  };
  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <AlertDialogContent onCloseAutoFocus={host.restoreFocus}>
        {table.guests.length > 0 ? (
          <Occupied table={table} />
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('remove.title', { name: table.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('remove.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            {refusal ? <SeatingProblem refusal={refusal} /> : null}
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
