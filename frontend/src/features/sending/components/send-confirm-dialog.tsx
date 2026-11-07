import { useTranslation } from 'react-i18next';

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

import type { PendingSend } from './use-send';

interface SendConfirmProps {
  pending: PendingSend;
  /** Households nothing can reach, which this send will skip; `null` when unknown. */
  unreachable: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The event's first send asks once, since messages cannot be recalled (design PD-47). Every later
 * press sends at once: the backend makes a second press safe.
 */
export function SendConfirmDialog({ pending, unreachable, onConfirm, onCancel }: SendConfirmProps) {
  const { t } = useTranslation('sending');
  const { households } = pending;
  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {households === null
              ? t('confirm.titleUnknown')
              : t('confirm.title', { count: households })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('confirm.body')}</AlertDialogDescription>
          {unreachable ? (
            <p className="text-muted-foreground m-0 text-sm">
              {t('confirm.unreachable', { count: unreachable })}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
          <Button onClick={onConfirm}>{t('confirm.send')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
