import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { formatMinor } from '@/lib/money';
import type { PageActions } from '@/ui/app-form';
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

import { cancelOrder } from '../api';
import { cancelRefusal, type CancelRefusal } from '../refusals';
import type { OrderRow } from '../types';
import { RefusalText, useRefusalWords } from './refusal-text';

interface CancelDialogProps {
  eventId: string;
  row: OrderRow;
  page: PageActions;
  onClose: () => void;
}

/**
 * Cancelling an order (design PD-88): asks first, saying what happens, worded by whether money is
 * returned. Pressing again after no answer is safe: the backend never refunds twice.
 */
export function CancelDialog({ eventId, row, page, onClose }: CancelDialogProps) {
  const { t, i18n } = useTranslation('ticket-orders');
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<CancelRefusal | null>(null);
  const words = useRefusalWords();
  const isPaid = row.totalMinor !== '0';
  const amount = formatMinor(row.totalMinor, row.currency, i18n.language);
  const confirm = async () => {
    setRefusal(null);
    setIsBusy(true);
    try {
      const outcome = await cancelOrder(browserSession().api, eventId, row.id);
      onClose();
      const refunded = formatMinor(outcome.refundedMinor, outcome.currency, i18n.language);
      await page.done(
        t(outcome.status === 'REFUNDED' ? 'cancel.refunded' : 'cancel.cancelled', {
          name: row.buyerName,
          amount: refunded,
        }),
      );
    } catch (error) {
      const refused = cancelRefusal(error);
      setRefusal(refused);
      if (refused.kind === 'gone' || refused.kind === 'admitted' || refused.kind === 'notPaid')
        page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent onCloseAutoFocus={page.focusStatus}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(isPaid ? 'cancel.titlePaid' : 'cancel.titleFree', { name: row.buyerName })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p className="m-0">{t('cancel.lead')}</p>
              <ul className="m-0 pl-5">
                <li>{t('cancel.void', { count: row.ticketCount })}</li>
                {isPaid ? <li>{t('cancel.refund', { amount })}</li> : null}
                <li>{t('cancel.guests')}</li>
                <li>{t('cancel.email')}</li>
              </ul>
              <p className="m-0">{t('cancel.whole')}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal ? <RefusalText refusal={refusal} words={words.cancel(refusal)} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isBusy} onClick={() => void confirm()}>
            {t(isPaid ? 'cancel.confirmPaid' : 'cancel.confirmFree')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
