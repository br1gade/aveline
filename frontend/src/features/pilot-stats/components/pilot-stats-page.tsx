import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LoadedProblem } from '@/features/sending';
import { APP_PATHS } from '@/route-paths';

import type { PilotStatsData } from '../load';
import { shareOf } from '../totals';
import type { PilotTotals } from '../types';

const FIGURE = 'font-serif text-[28px] leading-[34px]';

function Total({ term, value, children }: { term: string; value: string; children?: ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-1 border px-5 py-4">
      <dt className="text-sm font-medium">{term}</dt>
      <dd className="m-0 flex flex-col gap-1">
        <span className={FIGURE}>{value}</span>
        {children}
      </dd>
    </div>
  );
}

/** A share in the page's language, or a dash when there is nothing to take it of. */
function useShare() {
  const { t } = useTranslation('pilot-stats');
  return (part: number, whole: number) => {
    const share = shareOf(part, whole);
    return share === null ? '—' : t('share', { share });
  };
}

function Totals({ totals }: { totals: PilotTotals }) {
  const { t } = useTranslation('pilot-stats');
  const share = useShare();
  const note = (text: string) => <span className="text-muted-foreground text-sm">{text}</span>;
  return (
    <dl className="m-0 grid max-w-[48rem] gap-3 sm:grid-cols-2">
      <Total term={t('hosts')} value={t('count', { count: totals.hosts })} />
      <Total term={t('invitationsSent')} value={t('count', { count: totals.invitationsSent })}>
        {note(t('invitationsSentAbout'))}
      </Total>
      <Total term={t('replied')} value={share(totals.guestsReplied, totals.guests)}>
        {note(t('repliedOf', { part: totals.guestsReplied, whole: totals.guests }))}
      </Total>
      <Total term={t('checkedIn')} value={share(totals.guestsCheckedIn, totals.guestsAttending)}>
        {note(t('checkedInOf', { part: totals.guestsCheckedIn, whole: totals.guestsAttending }))}
        {note(t('checkedInAbout'))}
      </Total>
    </dl>
  );
}

/**
 * The four numbers the pilot's success is read from (audit Q6; design PD-205): totals across every
 * customer, counted when the page opens, with no period.
 */
export function PilotStatsPage({ data }: { data: PilotStatsData }) {
  const { t } = useTranslation('pilot-stats');
  const { totals } = data;
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={APP_PATHS.staff}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      {totals.kind === 'ready' ? (
        <Totals totals={totals.value} />
      ) : (
        <LoadedProblem loaded={totals} refusedText={t('refused')} />
      )}
    </section>
  );
}
