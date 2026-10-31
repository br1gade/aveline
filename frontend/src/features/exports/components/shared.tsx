import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/ui';
import { Alert, AlertDescription } from '@/ui/kit/alert';
import { Button } from '@/ui/kit/button';

import { redactedOf } from '../intent';
import type { RefusalKey, RefusalOffer } from '../refusals';
import type { Exports, PlacedRefusal } from './use-exports';

export const LINK = 'text-primary self-start underline underline-offset-4 hover:no-underline';
export const PANEL = 'bg-card border-border flex flex-col gap-4 border px-5 py-4';
/** The kit's buttons never wrap; a long Armenian label would run past a 360 px screen. */
export const WRAP =
  'h-auto min-h-10 py-2 text-left whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11';

/** Keys whose own words say less than the backend's sentence, shown under them in English. */
const WITH_SENTENCES: readonly RefusalKey[] = ['create.check', 'other'];

/** What a refusal's offer does: the copy without contacts, the same export again, the same press. */
export function useOffer(exports: Exports): (placed: PlacedRefusal, offer: RefusalOffer) => void {
  return (placed, offer) => {
    if (offer === 'tryAgain' && placed.snapshot) {
      void exports.download(placed.snapshot);
      return;
    }
    const intent = offer === 'redacted' ? redactedOf(placed.intent) : placed.intent;
    if (intent) void exports.create(intent, placed.at);
  };
}

interface ExportProblemProps {
  placed: PlacedRefusal;
  exports: Exports;
}

/**
 * A refused export or download, in our words (design PD-76), with an icon, the server's reference
 * when it failed, and what can be done. It takes the focus when it appears, as `ProblemAlert` does.
 */
export function ExportProblem({ placed, exports }: ExportProblemProps) {
  const { t } = useTranslation('exports');
  const { t: common } = useTranslation('common');
  const offer = useOffer(exports);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [placed]);
  const { refusal } = placed;
  const sentences = WITH_SENTENCES.includes(refusal.key) ? refusal.messages : [];
  const isBusy = exports.creatingAt !== null || exports.downloadingId !== null;
  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1} className="outline-none">
      <Icon name="circle-alert" size={16} />
      <AlertDescription>
        <span>{t(`problems.${refusal.key}`)}</span>
        {sentences.map((message) => (
          <span key={message} lang="en" className="block">
            {message}
          </span>
        ))}
        {refusal.requestId ? (
          <span className="block">
            {common('error.reference', { requestId: refusal.requestId })}
          </span>
        ) : null}
        {refusal.offer ? (
          <Button
            type="button"
            variant="outline"
            className={`mt-1 ${WRAP}`}
            disabled={isBusy}
            onClick={() => (refusal.offer ? offer(placed, refusal.offer) : undefined)}
          >
            {t(`offers.${refusal.offer}`)}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
