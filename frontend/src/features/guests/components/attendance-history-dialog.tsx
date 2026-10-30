import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { formatEventDay, formatEventTime } from '@/lib/time';
import { ProblemAlert } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import { getAttendanceHistory } from '../api';
import type { AttendanceRecord, Guest } from '../types';
import type { DialogHostActions } from './use-list-dialogs';

type History =
  | { kind: 'loading' }
  | { kind: 'ready'; records: AttendanceRecord[] }
  | { kind: 'failed'; problem: Problem };

/** Consecutive records of one way of answering, so each is headed once. */
function byRevision(records: readonly AttendanceRecord[]): AttendanceRecord[][] {
  const groups: AttendanceRecord[][] = [];
  for (const record of records) {
    const last = groups.at(-1);
    if (last?.[0]?.revision === record.revision) last.push(record);
    else groups.push([record]);
  }
  return groups;
}

function RecordLine({ record, timeZone }: { record: AttendanceRecord; timeZone: string }) {
  const { t, i18n } = useTranslation('guests');
  const zone = { timeZone, locale: i18n.language };
  const answer = t(`answer.${record.answer}`);
  const what = record.venue ? t('history.venueAnswer', { venue: record.venue, answer }) : answer;
  const when = record.respondedAt
    ? t('history.answered', {
        when: `${formatEventDay(record.respondedAt, zone)}, ${formatEventTime(record.respondedAt, zone)}`,
      })
    : t('history.timeUnknown');
  return (
    <li>
      {what} · <span className="text-muted-foreground">{when}</span>
    </li>
  );
}

function HistoryGroups({ records, timeZone }: { records: AttendanceRecord[]; timeZone: string }) {
  const { t } = useTranslation('guests');
  if (records.length === 0) return <p className="m-0">{t('history.empty')}</p>;
  return byRevision(records).map((group) => {
    const first = group[0];
    if (!first) return null;
    const way =
      first.mode === 'PER_VENUE' || first.mode === 'EVENT_WIDE'
        ? t(`history.mode.${first.mode}`)
        : first.mode;
    const state = first.isCurrent ? t('history.current') : t('history.earlier');
    return (
      <section key={first.revision} className="flex flex-col gap-1">
        <h3 className="m-0 text-sm font-medium">{t('history.group', { way, state })}</h3>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          {group.map((record, index) => (
            <RecordLine key={index} record={record} timeZone={timeZone} />
          ))}
        </ul>
      </section>
    );
  });
}

/** The words for a read that did not come back: not this role's, the guest gone, or a failure. */
function refusedText(
  status: number,
  t: (key: 'history.refused' | 'history.missing' | 'history.failed') => string,
) {
  if (status === 403) return t('history.refused');
  return status === 404 ? t('history.missing') : t('history.failed');
}

interface HistoryProps {
  event: EventDetail;
  guest: Guest;
  host: DialogHostActions;
}

/**
 * Each answer the guest gave under each way guests were asked (design PD-72), read only when the
 * dialog opens: the list itself carries only the current answers. A time the backend does not
 * know, as for an imported answer, is said, never guessed.
 */
export function AttendanceHistoryDialog({ event, guest, host }: HistoryProps) {
  const { t } = useTranslation('guests');
  const [history, setHistory] = useState<History>({ kind: 'loading' });
  useEffect(() => {
    let isCurrent = true;
    getAttendanceHistory(browserSession().api, event.id, guest.id).then(
      (records) => {
        if (isCurrent) setHistory({ kind: 'ready', records });
      },
      (error: unknown) => {
        if (isCurrent) setHistory({ kind: 'failed', problem: problemFrom(error) });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [event.id, guest.id]);
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[30rem]"
        onCloseAutoFocus={host.restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('history.title', { name: guest.name })}</DialogTitle>
        </DialogHeader>
        {history.kind === 'loading' ? (
          <p className="m-0" role="status">
            {t('history.loading')}
          </p>
        ) : null}
        {history.kind === 'failed' ? (
          <ProblemAlert problem={history.problem} refused={(status) => refusedText(status, t)} />
        ) : null}
        {history.kind === 'ready' ? (
          <HistoryGroups records={history.records} timeZone={event.timezone} />
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t('history.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
