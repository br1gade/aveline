import type { MetaDescriptor } from 'react-router';

import { createI18n, type Language } from '@/lib/i18n';

/** Kept out of search results until the public site exists, as the listing is (design PD-145). */
export function pricingMeta(language: Language): MetaDescriptor[] {
  const t = createI18n(language).getFixedT(language, 'billing');
  return [
    { title: t('pricing.metaTitle') },
    { name: 'robots', content: 'noindex,follow' },
    { name: 'description', content: t('pricing.lead') },
  ];
}
