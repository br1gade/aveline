import { useTranslation } from 'react-i18next';

import { isLanguage, type Language } from '@/lib/i18n';
import { Icon } from '@/ui';

interface LanguageSwitcherProps {
  current: string;
  available: readonly string[];
  /** The page in another language: the generic link with `?locale=`. */
  hrefFor: (language: Language) => string;
}

/**
 * Each language named in itself, never a flag (design R-17). A native disclosure, so it works
 * before the page hydrates. Shown when the event publishes more than one language, on the generic
 * and the personal link alike; switching does not change the guest's stored language.
 */
export function LanguageSwitcher({ current, available, hrefFor }: LanguageSwitcherProps) {
  const { t } = useTranslation('invitation');
  const languages = available.filter(isLanguage);
  if (languages.length < 2 || !isLanguage(current)) return null;

  return (
    <details className="group relative">
      <summary
        aria-label={`${t('language.label')}: ${t(`language.${current}`)}`}
        className="border-control-edge text-text inline-flex min-h-(--target-min) cursor-pointer list-none items-center gap-2 border px-3 text-[13px] leading-[18px] font-medium [&::-webkit-details-marker]:hidden"
      >
        <Icon name="globe" />
        <span lang={current}>{t(`language.${current}`)}</span>
        <Icon name="chevron-down" className="transition-transform group-open:rotate-180" />
      </summary>
      <ul className="border-line bg-porcelain absolute top-full left-0 z-20 m-0 mt-1 min-w-[180px] list-none border py-1 shadow-(--shadow-float)">
        {languages.map((language) => (
          <li key={language}>
            <a
              href={hrefFor(language)}
              lang={language}
              hrefLang={language}
              aria-current={language === current ? 'true' : undefined}
              className="text-ink hover:bg-linen aria-[current=true]:text-brand-burgundy flex min-h-(--target-min) items-center justify-between gap-3 px-4 text-[15px] leading-[22px] no-underline aria-[current=true]:font-semibold"
            >
              {t(`language.${language}`)}
              {language === current ? <Icon name="check" size={16} /> : null}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
