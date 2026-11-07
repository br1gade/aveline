import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { EventDetail } from '@/features/events';
import { formatEventDay, formatEventTime, formatLocale } from '@/lib/time';

import type { Readable } from '../load';
import type { ImportRecord } from '../types';
import { RefusedRows } from './refused-rows';

function ImportEntry({ record, event }: { record: ImportRecord; event: EventDetail }) {
  const { t, i18n } = useTranslation('guests');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  const number = new Intl.NumberFormat(formatLocale(i18n.language));
  const when = t('import.history.when', {
    date: formatEventDay(record.createdAt, zone),
    time: formatEventTime(record.createdAt, zone),
  });
  return (
    <li className="border-border flex flex-col gap-1 border-t py-3 first:border-t-0">
      <p className="m-0 font-medium break-all">{record.filename}</p>
      <p className="text-muted-foreground m-0 text-sm">
        {when} · {t(`import.history.status.${record.status}`)}
      </p>
      <p className="m-0 text-sm">
        {t('import.history.counts', {
          imported: number.format(record.rowsImported),
          refused: number.format(record.rowsFailed),
        })}
      </p>
      {record.errors.length > 0 ? (
        <details className="text-sm">
          <summary className="text-primary min-h-(--target-min) cursor-pointer py-2">
            {t('import.history.showRows', { count: record.errors.length })}
          </summary>
          <RefusedRows errors={record.errors} t={t} />
        </details>
      ) : null}
    </li>
  );
}

/**
 * The last imports, newest first, each dated in the event's own zone, never the device's
 * (docs/API.md §1). The refused rows fold away; a mistyped email is never quoted here, since the
 * backend keeps only the row and the reason.
 */
export function ImportHistory({
  history,
  event,
}: {
  history: Readable<ImportRecord[]>;
  event: EventDetail;
}) {
  const { t } = useTranslation('guests');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="m-0 text-base font-medium">
        {t('import.history.title')}
      </h2>
      {history.kind === 'refused' ? (
        <p className="text-muted-foreground m-0">{t('import.history.refused')}</p>
      ) : null}
      {history.kind === 'ready' && history.value.length === 0 ? (
        <p className="text-muted-foreground m-0">{t('import.history.empty')}</p>
      ) : null}
      {history.kind === 'ready' && history.value.length > 0 ? (
        <ul className="bg-card border-border m-0 flex list-none flex-col border px-5 py-1">
          {history.value.map((record) => (
            <ImportEntry key={record.id} record={record} event={event} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
