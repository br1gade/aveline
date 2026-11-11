import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath, type EventDetail } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import { ChangeableWith } from '@/features/permissions';
import { formatEventDate, formatEventTime } from '@/lib/time';
import {
  StatusLine,
  useDialogOpener,
  usePageStatus,
  WRAPPING_BUTTON,
  type DialogContext,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { RunningOrderData } from '../load';
import { labelIn } from '../read';
import type { TimelineEntry } from '../types';
import { EntryDialog } from './entry-dialog';
import { RemoveEntryDialog } from './remove-entry-dialog';

type OpenDialog = { kind: 'add' } | { kind: 'edit' | 'remove'; entry: TimelineEntry };
type OpenHandler = (dialog: OpenDialog, opener: HTMLElement) => void;

/** The entry's name in the event's language, else in the first it has, marked as that language. */
function useEntryName(event: EventDetail) {
  const { t } = useTranslation('running-order');
  return (entry: TimelineEntry) =>
    labelIn(entry.label, event.defaultLocale) ?? { text: t('entry.noName'), language: undefined };
}

/** Entries in the API's order, cut where the day changes in the event's zone. */
function byDay(entries: readonly TimelineEntry[], dayOf: (iso: string) => string) {
  const days: Array<{ day: string; entries: TimelineEntry[] }> = [];
  for (const entry of entries) {
    const day = dayOf(entry.occursAt);
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}

interface EntryRowProps {
  entry: TimelineEntry;
  event: EventDetail;
  /** The event's venues' names by id, built once for the list. */
  venueNames: ReadonlyMap<string, string>;
  onOpen: OpenHandler;
}

function EntryRow({ entry, event, venueNames, onOpen }: EntryRowProps) {
  const { t, i18n } = useTranslation('running-order');
  const name = useEntryName(event)(entry);
  const zone = { timeZone: event.timezone, locale: i18n.language };
  const venue = (entry.venueId && venueNames.get(entry.venueId)) || entry.venueName;
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="font-medium tabular-nums">{formatEventTime(entry.occursAt, zone)}</span>
        <span lang={name.language} className="min-w-0 break-words">
          {name.text}
        </span>
      </div>
      {venue ? <p className="m-0 text-sm">{t('entry.at', { venue })}</p> : null}
      {entry.isInternal ? (
        <p className="text-muted-foreground m-0 text-sm">{t('entry.team')}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={WRAPPING_BUTTON}
          aria-label={t('entry.editFor', { name: name.text })}
          onClick={(click) => onOpen({ kind: 'edit', entry }, click.currentTarget)}
        >
          {t('entry.edit')}
        </Button>
        <Button
          variant="outline"
          className={WRAPPING_BUTTON}
          aria-label={t('entry.removeFor', { name: name.text })}
          onClick={(click) => onOpen({ kind: 'remove', entry }, click.currentTarget)}
        >
          {t('entry.remove')}
        </Button>
      </div>
    </li>
  );
}

function EntryList({ data, onOpen }: { data: RunningOrderData; onOpen: OpenHandler }) {
  const { t, i18n } = useTranslation('running-order');
  const headingId = useId();
  const { event, venues, entries } = data;
  if (entries.kind !== 'ready') {
    return <LoadedProblem loaded={entries} refusedText={t('listRefused')} />;
  }
  if (entries.value.length === 0) return <p className="m-0">{t('empty')}</p>;
  const zone = { timeZone: event.timezone, locale: i18n.language };
  const venueNames = new Map(venues.map((venue) => [venue.id, venue.name]));
  return (
    <div className="flex max-w-[40rem] flex-col gap-6">
      {byDay(entries.value, (iso) => formatEventDate(iso, zone)).map(
        ({ day, entries: list }, index) => (
          <section
            key={day}
            aria-labelledby={`${headingId}-${index}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`${headingId}-${index}`} className="m-0 text-lg font-medium">
              {day}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {list.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  event={event}
                  venueNames={venueNames}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function CurrentDialog({
  dialog,
  data,
  context,
}: {
  dialog: OpenDialog | null;
  data: RunningOrderData;
  context: DialogContext;
}) {
  const name = useEntryName(data.event);
  if (!dialog) return null;
  const entries = data.entries.kind === 'ready' ? data.entries.value : [];
  const shared = { ...context, venues: data.venues, entries };
  if (dialog.kind === 'remove') {
    return (
      <RemoveEntryDialog
        {...shared}
        eventId={data.event.id}
        entry={dialog.entry}
        name={name(dialog.entry).text}
      />
    );
  }
  return (
    <EntryDialog
      {...shared}
      event={data.event}
      entry={dialog.kind === 'edit' ? dialog.entry : undefined}
    />
  );
}

/**
 * The day's running order (docs/API.md §6; design PD-106): what happens when, and where, in the
 * event's zone. A role without `event:write` sees it with nothing to press (FR-6, PD-193); a 403
 * is still worded.
 * No "let your guests know" follows a change: the backend returns no notice for it (FR-94).
 */
export function RunningOrderPage({ data }: { data: RunningOrderData }) {
  const { t } = useTranslation('running-order');
  const { event } = data;
  const { page, status, statusRef } = usePageStatus(data);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const open: OpenHandler = (next, opener) => {
    remember(opener);
    setDialog(next);
  };
  const context = { page, onClose: () => setDialog(null), restoreFocus };
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={eventPath(event.id)}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <p className="text-muted-foreground m-0 max-w-[40rem] text-sm">
        {t('zone', { timeZone: event.timezone.replaceAll('_', ' ') })}
      </p>
      {/* Adding needs the list: where an entry goes, and what guests stop seeing, are read from it. */}
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <ChangeableWith to="event:write" readOnly={t('refused.forbidden')}>
        {data.entries.kind === 'ready' ? (
          <Button
            className={`self-start ${WRAPPING_BUTTON}`}
            onClick={(click) => open({ kind: 'add' }, click.currentTarget)}
          >
            {t('add')}
          </Button>
        ) : null}
        <EntryList data={data} onOpen={open} />
      </ChangeableWith>
      <CurrentDialog dialog={dialog} data={data} context={context} />
    </section>
  );
}
