import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { LANGUAGES, type Language } from '@/lib/i18n';
import { LanguageSwitcher } from '@/ui';
import { Card, CardContent, CardFooter, CardHeader } from '@/ui/kit/card';

interface AccountLayoutProps {
  title: string;
  /** A line under the title. */
  lead?: string | undefined;
  children: ReactNode;
  /** Links to the other account pages, under the card. */
  footer?: ReactNode;
}

/**
 * Every account page (design PD-39, until the designer answers DQ-13): one centred column on
 * ivory, the wordmark and the language switcher, then a card with a serif title. Built from the
 * app's kit, mapped onto the tokens by DESIGN_SYSTEM §12.
 */
export function AccountLayout({ title, lead, children, footer }: AccountLayoutProps) {
  const { t, i18n } = useTranslation('common');
  const location = useLocation();
  // The same page in another language. `?next=` stays; a `?token=` never goes into a link, so the
  // page's HTML never holds the credential. The page keeps the token it read in memory, and the
  // switch is a client navigation, so nothing is lost.
  const hrefFor = (language: Language) => {
    const params = new URLSearchParams(location.search);
    params.delete('token');
    params.set('lang', language);
    return `?${params.toString()}`;
  };

  return (
    <main className="bg-background text-foreground flex min-h-svh justify-center px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-[26rem] flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <p className="text-primary m-0 font-serif text-lg tracking-[0.24em] uppercase">
            {t('appName')}
          </p>
          <LanguageSwitcher
            current={i18n.language}
            available={LANGUAGES}
            hrefFor={hrefFor}
            isClientNavigation
            align="end"
          />
        </header>
        <Card className="gap-5">
          <CardHeader className="gap-2">
            <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{title}</h1>
            {lead ? <p className="text-muted-foreground m-0 text-sm">{lead}</p> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-5 text-[15px] leading-[22px]">
            {children}
          </CardContent>
          {footer ? (
            <CardFooter className="flex flex-col items-start gap-2 text-sm">{footer}</CardFooter>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
