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

import { removeMedia } from '../api';
import { isStaleRefusal } from '../refusals';
import type { LibraryItem } from '../types';
import { DesignRefusal, type DesignRefusalState } from './design-parts';
import { MediaThumbnail } from './media-thumbnail';

interface RemoveMediaProps {
  item: LibraryItem;
  eventId: string;
  languages: readonly string[];
  page: PageActions;
  onClose: () => void;
}

/**
 * Removing an upload nothing shows, after a confirmation (design PD-62); its file goes too. A
 * section or the public listing that shows it makes the backend refuse with a 409, and the page
 * reloads behind the words, since its view was out of date.
 */
export function RemoveMediaDialog({ item, eventId, languages, page, onClose }: RemoveMediaProps) {
  const { t } = useTranslation('design');
  const [isRemoving, setIsRemoving] = useState(false);
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const isDoneRef = useRef(false);

  const confirm = async () => {
    setRefusal(null);
    setIsRemoving(true);
    try {
      await removeMedia(browserSession().api, eventId, item.id);
      await page.done(t('media.removed'));
      isDoneRef.current = true;
      onClose();
    } catch (error) {
      setRefusal({ action: 'removeMedia', problem: problemFrom(error) });
      setIsRemoving(false);
      if (isStaleRefusal('removeMedia', error)) page.reload();
    }
  };

  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent
        onCloseAutoFocus={(closing) => (isDoneRef.current ? page.focusStatus(closing) : undefined)}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('removeMedia.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('removeMedia.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <MediaThumbnail media={item} languages={languages} />
        {refusal ? <DesignRefusal refusal={refusal} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('removeMedia.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isRemoving} onClick={() => void confirm()}>
            {isRemoving ? t('removeMedia.removing') : t('removeMedia.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
