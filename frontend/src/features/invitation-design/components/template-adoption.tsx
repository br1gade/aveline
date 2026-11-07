import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRevalidator, useSearchParams } from 'react-router';

import { createRetryKey } from '@/api/retry-key';
import { browserSession } from '@/api/session';
import { pollUntil, waitFor } from '@/lib/poll';
import { Notice } from '@/ui';
import { WordedRefusal, WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import {
  adoptionRefusalOf,
  type AdoptionRead,
  type AdoptionRefusal,
  type AdoptionChanges,
} from '../adoption';
import { confirmAdoption, pollAdoption } from '../api';
import type { AdoptionData } from '../load';
import { designLookPath, designPath } from '../paths';
import { PreviewPage } from './design-preview';
import { TEXT_LINK, useSectionName } from './design-parts';

/** About half a minute, as the drawn signature's check; then the host can look again. */
const POLL_DELAYS = [1000, 2000, 4000, 4000, 4000, 5000, 5000, 5000];

type Shown = AdoptionRead | { state: 'stillPreparing' };

/** Event copies of the template's artwork are made by a worker: wait for them while on the page. */
function useFollowed(read: AdoptionRead | null, slug: string): Shown | null {
  const [followed, setFollowed] = useState<{ read: AdoptionRead; shown: Shown } | null>(null);
  useEffect(() => {
    if (read?.state !== 'processing') return;
    const stop = new AbortController();
    void pollUntil<AdoptionRead>({
      read: () => pollAdoption(browserSession().api, slug, read.previewId),
      isDone: (value) => value.state !== 'processing',
      delays: POLL_DELAYS,
      wait: waitFor,
      signal: stop.signal,
    }).then((done) => {
      if (!stop.signal.aborted) setFollowed({ read, shown: done ?? { state: 'stillPreparing' } });
    });
    return () => stop.abort();
  }, [read, slug]);
  return followed?.read === read ? followed.shown : read;
}

function Changes({ changes }: { changes: AdoptionChanges }) {
  const { t } = useTranslation('design');
  const nameOf = useSectionName();
  const names = (types: readonly string[]) => types.map(nameOf).join(', ');
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
      {changes.themeReset ? <li>{t('adopt.themeReset')}</li> : null}
      {changes.disabledBlocks.length > 0 ? (
        <li>{t('switch.hidden', { sections: names(changes.disabledBlocks) })}</li>
      ) : null}
      {changes.resetVariants.length > 0 ? (
        <li>{t('switch.layouts', { sections: names(changes.resetVariants) })}</li>
      ) : null}
      <li>{t('switch.kept')}</li>
    </ul>
  );
}

function RefusalWords({ refusal }: { refusal: AdoptionRefusal }) {
  const { t } = useTranslation('design');
  return (
    <WordedRefusal
      message={t(`adopt.refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={refusal.kind === 'noAnswer' ? refusal.requestId : undefined}
    />
  );
}

/** "Preview again" fetches a new one: a stale preview can't be confirmed, by design. */
function PreviewAgain({ label }: { label: string }) {
  const { revalidate, state } = useRevalidator();
  return (
    <Button
      variant="outline"
      className={`${WRAPPING_BUTTON} self-start`}
      disabled={state === 'loading'}
      onClick={() => void revalidate()}
    >
      {label}
    </Button>
  );
}

const CAN_TRY_AGAIN: ReadonlySet<AdoptionRefusal['kind']> = new Set([
  'stale',
  'preparing',
  'rateLimited',
  'noAnswer',
]);

interface ConfirmProps {
  data: AdoptionData;
  ready: Extract<AdoptionRead, { state: 'ready' }>;
  onDone: () => void;
}

/** One press, atomic; the same key after no answer, so it can't be applied twice (docs/API.md §6). */
function Confirm({ data, ready, onDone }: ConfirmProps) {
  const { t } = useTranslation('design');
  const [retry] = useState(() => createRetryKey());
  const [refusal, setRefusal] = useState<AdoptionRefusal | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const { design, target } = data;
  const confirm = async () => {
    if (!design || !target) return;
    setRefusal(null);
    setIsBusy(true);
    try {
      await confirmAdoption(browserSession().api, design.slug, {
        templateKey: target.key,
        templateVersionId: ready.targetVersionId,
        previewId: ready.previewId,
        expectedTemplateVersionId: ready.sourceVersionId,
        expectedDesignRevision: ready.expectedDesignRevision,
        idempotencyKey: retry.next(ready.previewId),
      });
      retry.settle(null);
      onDone();
    } catch (error) {
      retry.settle(error);
      setRefusal(adoptionRefusalOf(error));
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <>
      {refusal ? <RefusalWords refusal={refusal} /> : null}
      {refusal?.kind === 'stale' ? <PreviewAgain label={t('adopt.previewAgain')} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button className={WRAPPING_BUTTON} disabled={isBusy} onClick={() => void confirm()}>
          {t('adopt.confirm', { name: target?.name ?? '' })}
        </Button>
        <Button asChild variant="outline" className={WRAPPING_BUTTON}>
          <Link to={designLookPath(data.event.id)}>
            {t('adopt.keep', { name: design?.template.name ?? '' })}
          </Link>
        </Button>
      </div>
    </>
  );
}

function ProgressOrProblem({ data, shown }: { data: AdoptionData; shown: Shown | null }) {
  const { t } = useTranslation('design');
  if (data.refusal) {
    return (
      <>
        <RefusalWords refusal={data.refusal} />
        {CAN_TRY_AGAIN.has(data.refusal.kind) ? (
          <PreviewAgain label={t('adopt.previewAgain')} />
        ) : null}
      </>
    );
  }
  if (!shown) return <p className="m-0">{t('adopt.notOffered')}</p>;
  if (shown.state === 'processing') {
    return (
      <p role="status" className="m-0">
        {t('adopt.preparing')}
      </p>
    );
  }
  if (shown.state === 'failed') {
    return (
      <>
        <WordedRefusal message={t('adopt.refused.invalid')} />
        <PreviewAgain label={t('adopt.previewAgain')} />
      </>
    );
  }
  return shown.state === 'stillPreparing' ? (
    <>
      <Notice role="status">{t('adopt.stillPreparing')}</Notice>
      <PreviewAgain label={t('adopt.previewAgain')} />
    </>
  ) : null;
}

function useChosenPayload(ready: Extract<AdoptionRead, { state: 'ready' }> | null) {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!ready) return null;
    const chosen = params.get('locale');
    return (chosen && ready.payloads[chosen]) || Object.values(ready.payloads)[0] || null;
  }, [ready, params]);
}

interface BarProps {
  data: AdoptionData;
  shown: Shown | null;
  ready: Extract<AdoptionRead, { state: 'ready' }> | null;
  isDone: boolean;
  onDone: () => void;
}

/** Above the invitation, in the host's own language: what this is, and what to do about it. */
function AdoptionBar({ data, shown, ready, isDone, onDone }: BarProps) {
  const { t } = useTranslation('design');
  const eventId = data.event.id;
  const name = data.target?.name ?? '';
  return (
    <section
      aria-label={t('preview.bar')}
      className="bg-background text-foreground border-border flex flex-col gap-3 border-b px-4 py-3 text-[15px] leading-[22px] sm:px-8"
    >
      <Link to={designLookPath(eventId)} className={TEXT_LINK}>
        {t('back.look')}
      </Link>
      <h1 className="m-0 font-serif text-[22px] leading-7 font-normal break-words">
        {t('adopt.title', { name })}
      </h1>
      {isDone ? (
        <>
          <Notice role="status" tone="success">
            {t('adopt.done', { name })}
          </Notice>
          <Link to={designPath(eventId)} className={TEXT_LINK}>
            {t('back.design')}
          </Link>
        </>
      ) : (
        <>
          <ProgressOrProblem data={data} shown={shown} />
          {ready ? <Changes changes={ready.changes} /> : null}
          {ready ? (
            <Confirm key={ready.previewId} data={data} ready={ready} onDone={onDone} />
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * An authored template, shown before it is adopted (design PD-139): what changes in words, and the
 * invitation as it would read through its own renderer. An authored template's own fonts and
 * colours aren't drawn yet (FR-9, FR-42).
 */
export function TemplateAdoption({ data }: { data: AdoptionData }) {
  const shown = useFollowed(data.preview, data.design?.slug ?? '');
  const ready = shown?.state === 'ready' ? shown : null;
  const payload = useChosenPayload(ready);
  const [isDone, setIsDone] = useState(false);
  const bar = (
    <AdoptionBar
      data={data}
      shown={shown}
      ready={ready}
      isDone={isDone}
      onDone={() => setIsDone(true)}
    />
  );
  // The invitation's own page has its `main`; with none on screen, the bar is the page.
  if (!payload || isDone) return <main>{bar}</main>;
  return (
    <>
      {bar}
      <PreviewPage
        preview={payload}
        eventId={data.event.id}
        languageHref={(locale) => `?locale=${locale}`}
      />
    </>
  );
}
