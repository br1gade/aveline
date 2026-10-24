import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLocale } from '@/lib/time';

import type { HeadcountResult } from '../load';
import type { Headcount } from '../types';

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

function HeadcountBody({ result }: { result: HeadcountResult }) {
  const { t } = useTranslation('events');
  const { t: common } = useTranslation('common');
  switch (result.kind) {
    case 'ready':
      return result.headcount.invited > 0 ? (
        <Numbers headcount={result.headcount} />
      ) : (
        <p className="text-muted-foreground m-0">{t('headcount.empty')}</p>
      );
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
export function HeadcountSummary({ result }: { result: HeadcountResult }) {
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
      <HeadcountBody result={result} />
    </section>
  );
}
