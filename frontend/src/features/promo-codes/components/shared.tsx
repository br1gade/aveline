import { useTranslation } from 'react-i18next';

import { formatMinor } from '@/lib/money';
import { formatEventDay, formatEventTime } from '@/lib/time';
import { WordedRefusal } from '@/ui/app-form';

import { PROMO_CURRENCY, type PromoRefusal } from '../rules';
import type { PromoCode } from '../types';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function PromoProblem({ refusal }: { refusal: PromoRefusal }) {
  const { t } = useTranslation('promo-codes');
  return (
    <WordedRefusal
      message={t(`refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

/** "25% off" or "AMD 5,000 off", amounts never through a float (`lib/money`). */
export function useDiscountText() {
  const { t, i18n } = useTranslation('promo-codes');
  return (promo: Pick<PromoCode, 'kind' | 'value'>) =>
    promo.kind === 'PERCENT'
      ? t('code.percent', { value: promo.value })
      : t('code.amount', { amount: formatMinor(promo.value, PROMO_CURRENCY, i18n.language) });
}

/** A moment in the code's zone, which the page names. */
export function useMoment(zone: string) {
  const { i18n } = useTranslation('promo-codes');
  const where = { timeZone: zone, locale: i18n.language };
  return (iso: string) => `${formatEventDay(iso, where)}, ${formatEventTime(iso, where)}`;
}
