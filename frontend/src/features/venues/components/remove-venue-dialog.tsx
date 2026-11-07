import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Problem } from '@/api/problems';
import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { EventNotice } from '@/features/events';
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

import { removeVenue } from '../api';
import { removalMessages, useRefusedText } from '../refusals';
import type { Venue } from '../types';

interface RemoveVenueProps {
  eventId: string;
  venue: Venue;
  /** After the removal: reload the list, close, and act on the notice. */
  onRemoved: (notice: EventNotice) => Promise<void>;
  /** The list on screen is out of date (a 404): reload it behind the dialog. */
  onStale: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

interface Refusal {
  problem: Problem;
  /** The backend's own sentence, which says how many things still use the venue (FR-28). */
  messages: readonly string[];
}

/** Why it was refused: our words, then the backend's sentence in English, marked as English. */
function RefusalAlert({ refusal }: { refusal: Refusal }) {
  const refused = useRefusedText('remove');
  return (
    <ProblemAlert
      problem={refusal.problem}
      refused={(status) => (
        <>
          {refused(status, refusal.messages)}
          {refusal.messages.map((message) => (
            <span key={message} lang="en" className="block">
              {message}
            </span>
          ))}
        </>
      )}
    />
  );
}

/**
 * Removing a venue, after a confirmation (design PD-46). Refused while the running order, a table
 * or a released seat still points at it, and for good once guests have answered for it. The press
 * is a plain button, so the dialog stays open while the request runs and can show a refusal.
 */
export function RemoveVenueDialog({
  eventId,
  venue,
  onRemoved,
  onStale,
  onClose,
  onCloseAutoFocus,
}: RemoveVenueProps) {
  const { t } = useTranslation('venues');
  const [isRemoving, setIsRemoving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const confirm = async () => {
    setRefusal(null);
    setIsRemoving(true);
    try {
      await onRemoved(await removeVenue(browserSession().api, eventId, venue.id));
    } catch (error) {
      const problem = problemFrom(error);
      setRefusal({ problem, messages: removalMessages(error) });
      setIsRemoving(false);
      if (problem.code === 'refused' && problem.status === 404) onStale();
    }
  };

  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('remove.title', { name: venue.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('remove.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        {refusal ? <RefusalAlert refusal={refusal} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('remove.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isRemoving} onClick={() => void confirm()}>
            {isRemoving ? t('remove.removing') : t('remove.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
