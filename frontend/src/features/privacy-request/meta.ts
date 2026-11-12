import type { MetaDescriptor } from 'react-router';

import { createI18n, type Language } from '@/lib/i18n';

export function privacyRequestMeta(language: Language): MetaDescriptor[] {
  const t = createI18n(language).getFixedT(language, 'privacy-request');
  return [
    { title: t('metaTitle') },
    { name: 'robots', content: 'noindex,follow' },
    { name: 'description', content: t('lead') },
  ];
}

/** The placeholder notice is kept out of search engines until it is the real one (PD-194). */
export function privacyNoticeMeta(language: Language): MetaDescriptor[] {
  const t = createI18n(language).getFixedT(language, 'privacy-request');
  return [{ title: t('notice.metaTitle') }, { name: 'robots', content: 'noindex,follow' }];
}
