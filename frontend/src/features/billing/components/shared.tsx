import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatMinor } from '@/lib/money';
import { formatEventDay, DEFAULT_TIME_ZONE } from '@/lib/time';
import { APP_PATHS } from '@/route-paths';
import { WordedRefusal } from '@/ui/app-form';

import { isFree } from '../plans';
import type { BillingRefusal } from '../refusals';

/**
 * A refusal in our words (FR-6); the pilot's has its own notice, never this. One that choosing an
 * organization answers offers the choice, as an event page does.
 */
export function BillingProblem({ refusal }: { refusal: BillingRefusal }) {
  const { t } = useTranslation('billing');
  return (
    <>
      <WordedRefusal
        message={t(`refused.${refusal.kind}`)}
        english={refusal.kind === 'other' ? refusal.sentence : undefined}
        requestId={'requestId' in refusal ? refusal.requestId : undefined}
      />
      {refusal.kind === 'chooseOrganization' ? (
        <Link
          to={APP_PATHS.organizations}
          className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
        >
          {t('chooseOrganization')}
        </Link>
      ) : null}
    </>
  );
}

/** No event names a zone here, so dates are Yerevan's, and the page says so (design PD-129). */
export function useBillingDay() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    formatEventDay(iso, { timeZone: DEFAULT_TIME_ZONE, locale: i18n.language });
}

/** "AMD 25,000 a month", or "Free" for a price of nothing. Never through a float (`lib/money`). */
export function usePrice() {
  const { t, i18n } = useTranslation('billing');
  return (priceMinor: string, currency: string, interval: string) => {
    if (isFree(priceMinor)) return t('price.free');
    const amount = formatMinor(priceMinor, currency, i18n.language);
    return t(`price.${interval}`, { amount, defaultValue: amount });
  };
}
