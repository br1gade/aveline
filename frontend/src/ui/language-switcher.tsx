import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { isLanguage, type Language } from '@/lib/i18n';
import { cx } from './cx';
import { Icon } from './icon';

interface LanguageSwitcherProps {
  current: string;
  available: readonly string[];
  /** The same page in another language: `?locale=` on an invitation, `?lang=` elsewhere. */
  hrefFor: (language: Language) => string;
  /**
   * Switch without reloading the page, so what it holds in memory survives: a reset or invitation
   * page keeps the token it read and took out of the address bar. Before hydration it is a plain
   * link either way.
   */
  isClientNavigation?: boolean;
  /** Which edge the list opens from; `end` for a switcher at the right of a header. */
  align?: 'start' | 'end';
}

/** A chosen language closes the list, which a client navigation would otherwise leave open. */
function closeList(event: MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.closest('details')?.removeAttribute('open');
}

/**
 * Each language named in itself, never a flag (design R-17). A native disclosure, so it works
 * before the page hydrates. Shown only when there is more than one language to choose: on an
 * invitation, the ones its event publishes; on the account and app pages, all four (PD-40, C-23).
 */
export function LanguageSwitcher({
  current,
  available,
  hrefFor,
  isClientNavigation = false,
  align = 'start',
}: LanguageSwitcherProps) {
  const { t } = useTranslation('common');
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
      <ul
        className={cx(
          'border-line bg-porcelain absolute top-full z-20 m-0 mt-1 min-w-[180px] list-none border py-1 shadow-(--shadow-float)',
          align === 'end' ? 'right-0' : 'left-0',
        )}
      >
        {languages.map((language) => (
          <li key={language}>
            <LanguageLink
              href={hrefFor(language)}
              language={language}
              isCurrent={language === current}
              isClientNavigation={isClientNavigation}
            >
              {t(`language.${language}`)}
            </LanguageLink>
          </li>
        ))}
      </ul>
    </details>
  );
}

interface LanguageLinkProps {
  href: string;
  language: Language;
  isCurrent: boolean;
  isClientNavigation: boolean;
  children: string;
}

const LINK_CLASS =
  'text-ink hover:bg-linen aria-[current=true]:text-brand-burgundy flex min-h-(--target-min) items-center justify-between gap-3 px-4 text-[15px] leading-[22px] no-underline aria-[current=true]:font-semibold';

function LanguageLink({
  href,
  language,
  isCurrent,
  isClientNavigation,
  children,
}: LanguageLinkProps) {
  const shared = {
    lang: language,
    hrefLang: language,
    'aria-current': isCurrent ? ('true' as const) : undefined,
    className: LINK_CLASS,
  };
  const content = (
    <>
      {children}
      {isCurrent ? <Icon name="check" size={16} /> : null}
    </>
  );
  return isClientNavigation ? (
    <Link to={href} onClick={closeList} preventScrollReset {...shared}>
      {content}
    </Link>
  ) : (
    <a href={href} {...shared}>
      {content}
    </a>
  );
}
