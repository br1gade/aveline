import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PublicFrame } from '@/features/public-event';
import { APP_PATHS } from '@/route-paths';

import type { Plan } from '../types';
import { PlanCards } from './plan-list';

/**
 * The price list for anyone, signed in or not (docs/API.md §6; design PD-145). Choosing a plan
 * needs an organization, so each plan leads to creating an account; the billing page chooses.
 */
export function PricingPage({ plans }: { plans: readonly Plan[] }) {
  const { t } = useTranslation('billing');
  const { t: common } = useTranslation('common');
  return (
    <PublicFrame>
      <div className="flex flex-col gap-3">
        <h1 className="text-heading m-0 font-serif text-[36px] leading-[42px] font-light">
          {t('pricing.title')}
        </h1>
        <p className="m-0">{t('pricing.lead')}</p>
      </div>
      <PlanCards
        plans={plans}
        action={() => (
          <Link
            to={APP_PATHS.register}
            className="text-action mt-auto inline-flex min-h-11 items-center self-start underline decoration-1 underline-offset-3 hover:decoration-2"
          >
            {t('pricing.start')}
          </Link>
        )}
      />
      <Link
        to={APP_PATHS.privacyRequest}
        className="text-action inline-flex min-h-11 items-center self-start underline decoration-1 underline-offset-3"
      >
        {common('home.privacy')}
      </Link>
      <Link
        to={APP_PATHS.help}
        className="text-action inline-flex min-h-11 items-center self-start underline decoration-1 underline-offset-3"
      >
        {common('support.link')}
      </Link>
    </PublicFrame>
  );
}
