import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Loaded } from '@/api/loaded';
import { LoadedProblem } from '@/features/sending';
import { APP_PATHS } from '@/route-paths';

import { LINK } from './customer-new-event';

/**
 * What Aveline's own staff work from (design PD-164). The customers' list answering is what says this
 * account is staff's; a customer who finds the address is told whose it is, and offered nothing.
 */
export function StaffHome({ access }: { access: Loaded<unknown> }) {
  const { t } = useTranslation('customers');
  return (
    <section className="flex flex-col gap-4">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('home.title')}</h1>
      {access.kind === 'ready' ? (
        <>
          <p className="m-0 max-w-[40rem]">{t('home.lead')}</p>
          <nav aria-label={t('home.title')} className="flex flex-col gap-1">
            <Link to={APP_PATHS.staffCustomers} className={LINK}>
              {t('home.customers')}
            </Link>
            <Link to={APP_PATHS.staffDataRequests} className={LINK}>
              {t('home.dataRequests')}
            </Link>
            <Link to={APP_PATHS.staffAccessReviews} className={LINK}>
              {t('home.accessReviews')}
            </Link>
          </nav>
        </>
      ) : (
        <LoadedProblem loaded={access} refusedText={t('refusal.forbidden')} />
      )}
    </section>
  );
}
