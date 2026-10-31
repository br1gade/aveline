import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/kit/button';

import { sameIntentOf } from '../intent';
import {
  adviceOf,
  attemptOf,
  ATTEMPTS,
  failureKey,
  isActive,
  NEWEST,
  snapshotState,
  type SnapshotState,
} from '../states';
import type { Snapshot } from '../types';
import { ExportProblem, PANEL, WRAP } from './shared';
import type { ExportText } from './use-export-text';
import { AT_FORM, type Exports } from './use-exports';

interface RowProps {
  snapshot: Snapshot;
  exports: Exports;
  text: ExportText;
}

/** Where it stands, in words: the progress line while it is going, the outcome once it ended. */
function useStateLine(snapshot: Snapshot, state: SnapshotState, text: ExportText): string {
  const { t } = useTranslation('exports');
  const attempt = { attempt: attemptOf(snapshot), total: ATTEMPTS };
  switch (state) {
    case 'making':
    case 'retrying':
      return t(`state.${state}`, attempt);
    case 'expired':
      return snapshot.expiresAt
        ? t('state.expired', { when: text.moment(snapshot.expiresAt) })
        : t('state.expiredUndated');
    case 'withdrawn':
      return t('state.withdrawn', { when: text.moment(snapshot.revokedAt ?? snapshot.createdAt) });
    default:
      return t(`state.${state}`);
  }
}

/** Why it failed or was withdrawn: our words for the code, else the backend's in its language. */
function Reason({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useTranslation('exports');
  const key = failureKey(snapshot.failureReason);
  const advice = adviceOf(snapshot.recovery);
  const { recovery } = snapshot;
  return (
    <>
      {key ? <p className="m-0 text-sm">{t(`failure.${key}`)}</p> : null}
      {!key && recovery ? (
        <p lang={recovery.locale} className="m-0 text-sm">
          {recovery.userMessage}
        </p>
      ) : null}
      {advice ? <p className="m-0 text-sm">{t(`advice.${advice}`)}</p> : null}
    </>
  );
}

/** When it was read from the event, or asked for while nothing was read yet; until when it is kept. */
function Times({ snapshot, state, text }: RowProps & { state: SnapshotState }) {
  const { t } = useTranslation('exports');
  const taken = snapshot.snapshotAt
    ? t('list.taken', { when: text.moment(snapshot.snapshotAt) })
    : t('list.requested', { when: text.moment(snapshot.createdAt) });
  return (
    <p className="text-muted-foreground m-0 text-sm">
      {taken}
      {state === 'ready' && snapshot.expiresAt ? (
        <span className="block">{t('list.until', { when: text.moment(snapshot.expiresAt) })}</span>
      ) : null}
    </p>
  );
}

/** Download while it is ready; making it again whenever it is not going. */
function RowActions({ snapshot, exports, text }: RowProps) {
  const { t } = useTranslation('exports');
  const state = snapshotState(snapshot);
  if (isActive(snapshot)) return null;
  const name = [text.what(snapshot), text.details(snapshot), text.moment(snapshot.createdAt)].join(
    ', ',
  );
  const isDownloading = exports.downloadingId === snapshot.id;
  return (
    <div className="flex flex-wrap gap-2">
      {state === 'ready' ? (
        <Button
          className={WRAP}
          aria-label={t('actionFor', { action: t('list.download'), name })}
          disabled={exports.downloadingId !== null}
          onClick={() => void exports.download(snapshot)}
        >
          {isDownloading ? t('list.downloading') : t('list.download')}
        </Button>
      ) : null}
      <Button
        variant="outline"
        className={WRAP}
        aria-label={t('actionFor', { action: t('list.again'), name })}
        disabled={exports.creatingAt !== null}
        onClick={() => void exports.create(sameIntentOf(snapshot), snapshot.id)}
      >
        {exports.creatingAt === snapshot.id ? t('list.sending') : t('list.again')}
      </Button>
    </div>
  );
}

function SnapshotRow({ snapshot, exports, text }: RowProps) {
  const state = snapshotState(snapshot);
  const line = useStateLine(snapshot, state, text);
  const placed = exports.refusal?.at === snapshot.id ? exports.refusal : null;
  const hasReason = state === 'failed' || state === 'withdrawn';
  return (
    <li className="border-border flex flex-col gap-2 border-t py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <p className="m-0 font-medium break-words">{text.what(snapshot)}</p>
        <p className="text-muted-foreground m-0 text-sm">{text.details(snapshot)}</p>
      </div>
      <p className="m-0 text-sm font-medium">{line}</p>
      {hasReason ? <Reason snapshot={snapshot} /> : null}
      <Times snapshot={snapshot} state={state} exports={exports} text={text} />
      {placed ? <ExportProblem placed={placed} exports={exports} /> : null}
      <RowActions snapshot={snapshot} exports={exports} text={text} />
    </li>
  );
}

/** Still going when the reading stopped: the export carries on, and can be read again. */
function TimedOut({ exports }: { exports: Exports }) {
  const { t } = useTranslation('exports');
  const { list } = exports;
  if (!list.isTimedOut || !list.snapshots.some(isActive)) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm">{t('list.timedOut')}</p>
      <Button variant="outline" className={`self-start ${WRAP}`} onClick={list.follow}>
        {t('list.check')}
      </Button>
    </div>
  );
}

/**
 * The event's newest fifty exports (design PD-75), each with where it stands, when it was taken
 * in the event's zone, and what can be done with it. A refusal for an export no longer listed is
 * said above the list.
 */
export function SnapshotList({ exports, text }: { exports: Exports; text: ExportText }) {
  const { t } = useTranslation('exports');
  const { snapshots } = exports.list;
  const { refusal } = exports;
  const isUnlisted =
    refusal !== null && refusal.at !== AT_FORM && !snapshots.some((each) => each.id === refusal.at);
  return (
    <section aria-labelledby="exports-list" className={PANEL}>
      <h2 id="exports-list" className="m-0 text-lg font-medium">
        {t('list.title')}
      </h2>
      {isUnlisted ? <ExportProblem placed={refusal} exports={exports} /> : null}
      <TimedOut exports={exports} />
      {snapshots.length === 0 ? (
        <p className="text-muted-foreground m-0">{t('list.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {snapshots.map((snapshot) => (
            <SnapshotRow key={snapshot.id} snapshot={snapshot} exports={exports} text={text} />
          ))}
        </ul>
      )}
      {snapshots.length >= NEWEST ? (
        <p className="text-muted-foreground m-0 text-sm">{t('list.newest', { limit: NEWEST })}</p>
      ) : null}
    </section>
  );
}
