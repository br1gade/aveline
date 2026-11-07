import { useTranslation } from 'react-i18next';

import { Button, Notice } from '@/ui';

import { PHOTOS_PER_GUEST } from '../rules';
import type { BatchStop, FileOutcome } from '../upload-batch';
import type { SentBatch } from './share-photos';

/** A stop the guest can do nothing about here: no "Send the rest". */
const FINAL_STOPS: ReadonlySet<BatchStop['kind']> = new Set(['limit', 'full', 'closed']);

function outcomeKey(outcome: FileOutcome) {
  if (outcome.kind === 'refused') return `outcomes.refused.${outcome.reason}` as const;
  return `outcomes.${outcome.kind}` as const;
}

function StopNotice({
  stop,
  rest,
  onSendRest,
}: {
  stop: BatchStop;
  rest: number;
  onSendRest: () => void;
}) {
  const { t } = useTranslation('gallery');
  const canSendRest = rest > 0 && !FINAL_STOPS.has(stop.kind);
  const action = canSendRest ? (
    <Button variant="secondary" onClick={onSendRest} className="self-start">
      {t('share.sendRest', { rest })}
    </Button>
  ) : undefined;
  return (
    <Notice tone={stop.kind === 'stopped' ? 'info' : 'error'} role="alert" action={action}>
      <p>{t(`stops.${stop.kind}`, { limit: PHOTOS_PER_GUEST })}</p>
      {stop.kind === 'failed' && stop.requestId ? (
        <p className="text-ink-muted mt-1 text-sm select-all">
          {t('reference', { id: stop.requestId })}
        </p>
      ) : null}
    </Notice>
  );
}

/** What became of each photo chosen, then why the batch stopped, if it did. */
export function BatchSummary({ batch, onSendRest }: { batch: SentBatch; onSendRest: () => void }) {
  const { t } = useTranslation('gallery');
  const { files, result } = batch;
  const shared = result.outcomes.filter((outcome) => outcome.kind === 'shared').length;
  return (
    <div className="grid gap-3">
      <p className="text-ink m-0 text-sm font-medium">
        {t('share.done', { shared, total: files.length })}
      </p>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm leading-5">
        {result.outcomes.map((outcome, index) => (
          <li key={`${index}-${files[index]?.name ?? ''}`} className="flex flex-wrap gap-x-2">
            <bdi className="break-all">{files[index]?.name}</bdi>
            <span className={outcome.kind === 'refused' ? 'text-error' : 'text-ink-muted'}>
              {t(outcomeKey(outcome))}
            </span>
          </li>
        ))}
      </ul>
      {result.stop ? (
        <StopNotice stop={result.stop} rest={result.rest.length} onSendRest={onSendRest} />
      ) : null}
    </div>
  );
}
