import type { MetaDescriptor } from 'react-router';

import { createI18n, type Language } from '@/lib/i18n';

/** Search engines may list the price list (provisional, PD-204; it was kept out by PD-145). */
export function pricingMeta(language: Language): MetaDescriptor[] {
  const t = createI18n(language).getFixedT(language, 'billing');
  return [{ title: t('pricing.metaTitle') }, { name: 'description', content: t('pricing.lead') }];
}
