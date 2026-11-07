import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
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

import { updateSection } from '../api';
import { isStaleRefusal } from '../refusals';
import { DesignRefusal, type DesignRefusalState } from './design-parts';

interface HideReplyProps {
  slug: string;
  page: PageActions;
  onClose: () => void;
}

/**
 * Hiding the reply section of an invitation guests can already open asks first (design PD-56):
 * from then on, nobody who opens their link can answer. The press is a plain button, so the
 * dialog stays open while the request runs and can show a refusal.
 */
export function HideReplyDialog({ slug, page, onClose }: HideReplyProps) {
  const { t } = useTranslation('design');
  const [isHiding, setIsHiding] = useState(false);
  // Read as the dialog closes: after a hide, the focus goes to the page's status line.
  const isDoneRef = useRef(false);
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);

  const confirm = async () => {
    setRefusal(null);
    setIsHiding(true);
    try {
      await updateSection(browserSession().api, slug, 'RSVP', { enabled: false });
      await page.done(t('overview.hiddenStatus', { name: t('blocks.RSVP.name') }));
      isDoneRef.current = true;
      onClose();
    } catch (error) {
      setRefusal({ action: 'show', problem: problemFrom(error) });
      setIsHiding(false);
      if (isStaleRefusal('show', error)) page.reload();
    }
  };

  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent
        onCloseAutoFocus={(closing) => (isDoneRef.current ? page.focusStatus(closing) : undefined)}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('hideReply.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('hideReply.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        {refusal ? <DesignRefusal refusal={refusal} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('hideReply.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isHiding} onClick={() => void confirm()}>
            {isHiding ? t('hideReply.hiding') : t('hideReply.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
