import { useTranslation } from 'react-i18next';

import type { ArrivalsRead } from './use-arrivals';
import { useEventTime } from './shared';

/** The number above its label on a phone, so all four fit one row (design PD-90). */
function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col min-[480px]:flex-row min-[480px]:items-baseline min-[480px]:gap-2">
      <dt className="text-muted-foreground order-last min-w-0 text-xs leading-tight break-words min-[480px]:text-sm">
        {label}
      </dt>
      <dd className="m-0 font-serif text-[20px] leading-[26px] min-[480px]:text-[22px] min-[480px]:leading-[28px]">
        {value}
      </dd>
    </div>
  );
}

/**
 * The server's own counts, never worked out here: `arrived` can pass `expected`, and whoever was not
 * expected never comes off "still to come" (docs/API.md §6). Not a live region: a screen reader
 * should not read four numbers every twenty seconds.
 */
export function ArrivalCounts({ read, timeZone }: { read: ArrivalsRead; timeZone: string }) {
  const { t } = useTranslation('door');
  const timeOf = useEventTime(timeZone);
  if (read.problem === 'refused') return <p className="m-0 text-sm">{t('counts.refused')}</p>;
  const { counts, readAt, problem } = read;
  if (!counts) {
    return (
      <p className="text-muted-foreground m-0 text-sm">
        {t(problem ? 'counts.failed' : 'counts.loading')}
      </p>
    );
  }
  return (
    <section aria-label={t('counts.label')} className="flex flex-col gap-1">
      <dl className="m-0 grid grid-cols-4 gap-x-2 gap-y-1 min-[480px]:gap-x-4">
        <Count label={t('counts.arrived')} value={counts.arrived} />
        <Count label={t('counts.stillToCome')} value={counts.stillToCome} />
        <Count label={t('counts.expected')} value={counts.expected} />
        <Count label={t('counts.unexpected')} value={counts.unexpected} />
      </dl>
      {problem && readAt ? (
        <p className="text-muted-foreground m-0 text-sm">
          {t('counts.asOf', { time: timeOf(readAt) })}
        </p>
      ) : null}
    </section>
  );
}
