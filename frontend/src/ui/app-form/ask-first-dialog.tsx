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

import { WRAPPING_BUTTON } from './wrapping';

interface AskFirstDialogProps {
  /** From `useDialogAction`: it ignores a close while the request runs. */
  onOpenChange: (isOpen: boolean) => void;
  onCloseAutoFocus: (closing: Event) => void;
  title: string;
  body: string;
  confirmLabel: string;
  isBusy: boolean;
  /** The refusal, in the page's words, when the press was refused. */
  problem: ReactNode;
  onConfirm: () => void;
  /** False keeps the action unavailable: a deletion waits for its box to be ticked. */
  isConfirmable?: boolean;
  /** Anything more the person should read or tick before pressing. */
  children?: ReactNode;
}

/**
 * An action that can't be recalled asks first. Cancel takes the focus as the dialog opens (Radix's
 * alert dialog), so Enter pressed by habit cancels, and neither button works while the request runs.
 */
export function AskFirstDialog({
  onOpenChange,
  onCloseAutoFocus,
  title,
  body,
  confirmLabel,
  isBusy,
  problem,
  onConfirm,
  isConfirmable = true,
  children,
}: AskFirstDialogProps) {
  const { t } = useTranslation('common');
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {problem}
        <AlertDialogFooter>
          <AlertDialogCancel className={WRAPPING_BUTTON} disabled={isBusy}>
            {t('dialog.cancel')}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            className={WRAPPING_BUTTON}
            disabled={isBusy || !isConfirmable}
            onClick={onConfirm}
          >
            {isBusy ? t('dialog.working') : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
