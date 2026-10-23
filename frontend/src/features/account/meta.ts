import { createI18n, SOURCE_LANGUAGE, type Language } from '@/lib/i18n';

/** Account and app pages are never indexed: they are a door, not content. */
const NOINDEX = { name: 'robots', content: 'noindex' } as const;

type AccountPage = 'signIn' | 'register' | 'resetPassword' | 'verifyEmail' | 'invite';
type AppPage = 'home' | 'welcome';

export function accountMeta(page: AccountPage, language: Language = SOURCE_LANGUAGE) {
  const t = createI18n(language).getFixedT(language, 'account');
  return [{ title: t(`meta.${page}`) }, NOINDEX];
}

export function appMeta(page: AppPage, language: Language = SOURCE_LANGUAGE) {
  const t = createI18n(language).getFixedT(language, 'app');
  return [{ title: t(`meta.${page}`) }, NOINDEX];
}
