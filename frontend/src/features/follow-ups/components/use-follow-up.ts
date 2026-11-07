import { useState } from 'react';
import { useRevalidator } from 'react-router';

import { useDialogOpener } from '@/ui/app-form';

import { refusalOf, type FollowUpRefusal } from '../refusals';

/**
 * One send on this page: it asks first, then shows what came back (design PD-97, PD-98). Never
 * retried by itself. The button is disabled only while its request runs: a second press is safe,
 * since the backend sends a household no second reminder that day and no second thank-you ever.
 */
export function useFollowUp<T>(send: () => Promise<T>) {
  const { revalidate } = useRevalidator();
  const { remember, restoreFocus } = useDialogOpener();
  const [isAsking, setIsAsking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [outcome, setOutcome] = useState<T | null>(null);
  const [refusal, setRefusal] = useState<FollowUpRefusal | null>(null);

  const sendNow = async () => {
    setRefusal(null);
    setOutcome(null);
    setIsSending(true);
    try {
      setOutcome(await send());
      await revalidate();
    } catch (error) {
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) void revalidate();
    } finally {
      setIsSending(false);
    }
  };

  return {
    isAsking,
    isSending,
    outcome,
    refusal,
    restoreFocus,
    ask: (opener: HTMLElement) => {
      remember(opener);
      setIsAsking(true);
    },
    cancel: () => setIsAsking(false),
    confirm: () => {
      setIsAsking(false);
      void sendNow();
    },
  };
}
