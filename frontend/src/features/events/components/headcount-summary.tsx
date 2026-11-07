import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLocale } from '@/lib/time';

import type { HeadcountResult } from '../load';
import type { AttendanceMode, Headcount, VenueHeadcount } from '../types';

const COUNTS = ['invited', 'households', 'attending', 'declined', 'undecided', 'pending'] as const;

function Numbers({ headcount }: { headcount: Headcount }) {
  const { t, i18n } = useTranslation('events');
  const locale = formatLocale(i18n.language);
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {COUNTS.map((count) => (
        <div key={count} className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-sm">{t(`headcount.${count}`)}</dt>
          <dd className="m-0 font-serif text-2xl">{number.format(headcount[count])}</dd>
        </div>
      ))}
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-sm">{t('headcount.responseRate')}</dt>
        <dd className="m-0 font-serif text-2xl">{percent.format(headcount.responseRate / 100)}</dd>
      </div>
    </dl>
  );
}

const VENUE_COUNTS = ['attending', 'declined', 'undecided', 'pending'] as const;

/**
 * Each venue guests see, when they answer per venue (design PD-53): someone coming to the
 * ceremony and not the dinner counts once above, and here at each. On a narrow screen the table
 * scrolls sideways, so its box takes the focus and is named by the caption: a keyboard can scroll
 * it, and a screen reader says what it is (WCAG 2.1.1).
 */
function VenueTable({ venues }: { venues: readonly VenueHeadcount[] }) {
  const { t, i18n } = useTranslation('events');
  const captionId = useId();
  const number = new Intl.NumberFormat(formatLocale(i18n.language));
  return (
    <div role="region" aria-labelledby={captionId} tabIndex={0} className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption id={captionId} className="mb-2 text-left font-medium">
          {t('headcount.byVenue')}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-muted-foreground py-1 pr-4 text-left font-normal">
              {t('headcount.venue')}
            </th>
            {VENUE_COUNTS.map((count) => (
              <th
                key={count}
                scope="col"
                className="text-muted-foreground py-1 pr-4 text-right font-normal"
              >
                {t(`headcount.${count}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => (
            <tr key={venue.venueId} className="border-border border-t">
              <th scope="row" className="py-1 pr-4 text-left font-normal">
                {venue.venue}
              </th>
              {VENUE_COUNTS.map((count) => (
                <td key={count} className="py-1 pr-4 text-right tabular-nums">
                  {number.format(venue[count])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ready({ headcount, mode }: { headcount: Headcount; mode: AttendanceMode | undefined }) {
  const { t } = useTranslation('events');
  if (headcount.invited === 0) {
    return <p className="text-muted-foreground m-0">{t('headcount.empty')}</p>;
  }
  const venues = mode === 'PER_VENUE' ? (headcount.venues ?? []) : [];
  return (
    <>
      <Numbers headcount={headcount} />
      {venues.length > 0 ? <VenueTable venues={venues} /> : null}
    </>
  );
}

function HeadcountBody({
  result,
  mode,
}: {
  result: HeadcountResult;
  mode: AttendanceMode | undefined;
}) {
  const { t } = useTranslation('events');
  const { t: common } = useTranslation('common');
  switch (result.kind) {
    case 'ready':
      return <Ready headcount={result.headcount} mode={mode} />;
    case 'refused':
      return <p className="text-muted-foreground m-0">{t('headcount.refused')}</p>;
    case 'failed':
      return (
        <p className="m-0">
          {t('headcount.failed')}
          {result.requestId ? (
            <span className="text-muted-foreground block text-sm">
              {common('error.reference', { requestId: result.requestId })}
            </span>
          ) : null}
        </p>
      );
  }
}

/**
 * The headcount from the dashboard: numbers, not a chart (design PD-42). A designer may open the
 * event but not its numbers, and a failed dashboard says so here without hiding the event.
 */
export function HeadcountSummary({
  result,
  mode,
}: {
  result: HeadcountResult;
  /** How guests answer; the per-venue table shows only when they answer per venue. */
  mode?: AttendanceMode | undefined;
}) {
  const { t } = useTranslation('events');
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col gap-4 border px-5 py-4"
    >
      <h2 id={titleId} className="m-0 text-base font-medium">
        {t('headcount.title')}
      </h2>
      <HeadcountBody result={result} mode={mode} />
    </section>
  );
}
