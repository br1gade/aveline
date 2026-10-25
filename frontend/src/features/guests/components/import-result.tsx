import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { guestListPath } from '../paths';
import type { ImportResult } from '../types';
import { RefusedRows } from './refused-rows';

/**
 * What an import did. A partial import is the normal case and a success (a 201): the rows saved
 * are saved, and each refused one is listed by its own row number. The heading takes the focus when
 * it appears, so a keyboard or screen-reader user meets the outcome at once.
 */
export function ImportResultView({ eventId, result }: { eventId: string; result: ImportResult }) {
  const { t, i18n } = useTranslation('guests');
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [result]);
  const counts = {
    guests: t('count.guests', { count: result.rowsImported }),
    rows: t('count.rows', { count: result.rowsFailed }),
  };
  // Row 0 is the file itself (it could not be read, or has no rows), not a row to count.
  const isFileRefused =
    result.rowsImported === 0 &&
    result.errors.length > 0 &&
    result.errors.every((error) => error.row === 0);
  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col gap-3 border px-5 py-4"
    >
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="m-0 text-base font-medium outline-none"
      >
        {isFileRefused
          ? t('import.result.fileRefused')
          : t(`import.result.${result.status}`, counts)}
      </h2>
      {result.errors.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-medium">{t('import.refusedTitle')}</h3>
          {i18n.language === 'en' ? null : (
            <p className="text-muted-foreground m-0 text-sm">{t('import.inEnglish')}</p>
          )}
          <RefusedRows errors={result.errors} t={t} />
        </div>
      ) : null}
      {result.rowsImported > 0 ? (
        <Link
          to={guestListPath(eventId)}
          className="text-primary self-start underline underline-offset-4 hover:no-underline"
        >
          {t('import.guestList')}
        </Link>
      ) : null}
    </section>
  );
}
