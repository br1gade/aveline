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

interface FollowUpConfirmProps {
  title: string;
  body: string;
  sendLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  onCloseAutoFocus: (closing: Event) => void;
}

/** Messages cannot be recalled, so both sends ask first, every press (design PD-97, PD-98). */
export function FollowUpConfirmDialog({
  title,
  body,
  sendLabel,
  onConfirm,
  onCancel,
  onCloseAutoFocus,
}: FollowUpConfirmProps) {
  const { t } = useTranslation('follow-ups');
  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onCancel())}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('confirm.cancel')}</AlertDialogCancel>
          <Button onClick={onConfirm}>{sendLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
