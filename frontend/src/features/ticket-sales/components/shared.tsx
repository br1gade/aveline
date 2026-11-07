import type { ReactNode } from 'react';
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

export const PANEL = 'bg-card border-border flex max-w-[40rem] flex-col gap-4 border px-5 py-4';
export const HEADING = 'm-0 text-lg font-medium';
export const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

interface ConfirmProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  isBusy: boolean;
  /** A refusal, shown in the dialog, which stays open. */
  problem?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/** Asks first, in the kit's alert dialog (design PD-84); the press stays open while it runs. */
export function ConfirmDialog(props: ConfirmProps) {
  const { t } = useTranslation('ticket-sales');
  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : props.onClose())}>
      <AlertDialogContent onCloseAutoFocus={props.onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.body}</AlertDialogDescription>
        </AlertDialogHeader>
        {props.problem}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={props.isBusy} onClick={props.onConfirm}>
            {props.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
