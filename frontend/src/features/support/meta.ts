import type { MetaDescriptor } from 'react-router';

import { createI18n, type Language } from '@/lib/i18n';

export function helpMeta(language: Language): MetaDescriptor[] {
  const t = createI18n(language).getFixedT(language, 'common');
  return [{ title: t('support.metaTitle') }, { name: 'description', content: t('support.lead') }];
}
