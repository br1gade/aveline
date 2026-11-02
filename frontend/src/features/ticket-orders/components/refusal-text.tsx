import { useTranslation } from 'react-i18next';

import type { CancelRefusal, ReconcileRefusal } from '../refusals';

/** Our words for a refusal we know; `null` for one we do not, which is shown as it came. */
export function useRefusalWords() {
  const { t } = useTranslation('ticket-orders');
  return {
    cancel: (refusal: CancelRefusal) =>
      refusal.kind === 'other' ? null : t(`cancel.refusals.${refusal.kind}`),
    reconcile: (refusal: ReconcileRefusal) =>
      refusal.kind === 'other' ? null : t(`reconcile.refusals.${refusal.kind}`),
  };
}

interface RefusalTextProps {
  refusal: CancelRefusal | ReconcileRefusal;
  /** Our words, or `null` to show the backend's sentence, marked English. */
  words: string | null;
}

/** A refusal in words, with its reference when it has one. */
export function RefusalText({ refusal, words }: RefusalTextProps) {
  const { t } = useTranslation('ticket-orders');
  const reference =
    'requestId' in refusal && refusal.requestId ? (
      <span className="block">{t('reference', { requestId: refusal.requestId })}</span>
    ) : null;
  return (
    <p role="alert" className="text-destructive m-0 text-sm">
      {words ?? (
        <>
          {t('refusedWith')}{' '}
          <span lang="en">{refusal.kind === 'other' ? refusal.sentence : ''}</span>
        </>
      )}
      {reference}
    </p>
  );
}
