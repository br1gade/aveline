import { useState } from 'react';
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

interface RemovePhotoProps {
  /** Resolves `true` once removed; the page says any refusal. */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

/**
 * Removing a guest's photo, after a question (design PD-65): it is gone for everyone, and the guest
 * who shared it cannot bring it back. The press is a plain button, so the dialog stays while the
 * request runs.
 */
export function RemovePhotoDialog({ onConfirm, onClose, onCloseAutoFocus }: RemovePhotoProps) {
  const { t } = useTranslation('gallery');
  const [isRemoving, setIsRemoving] = useState(false);
  const confirm = async () => {
    setIsRemoving(true);
    await onConfirm();
    onClose();
  };
  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('host.removeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('host.removeBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('host.keep')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isRemoving} onClick={() => void confirm()}>
            {isRemoving ? t('host.removing') : t('host.removeConfirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
