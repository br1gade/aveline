import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { FooterMark } from '@/features/invitation-renderer';
import { APP_PATHS } from '@/route-paths';

const LINK =
  'text-action inline-flex min-h-11 items-center underline decoration-1 underline-offset-3 hover:decoration-2';

/**
 * The privacy notice and Help, under every page in this frame (design PD-196, audit F-03): a buyer,
 * a vendor or anyone reading the price list can find who holds their data and whom to ask. Each
 * page leaves out the link to itself. The invitation keeps its footer without words (C-12).
 */
function PublicLinks() {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const links = [
    { to: APP_PATHS.privacy, label: t('support.privacy') },
    { to: APP_PATHS.help, label: t('support.link') },
  ].filter((link) => link.to !== pathname);
  return (
    <nav
      aria-label={t('support.footerLabel')}
      className="mx-auto flex w-full max-w-[40rem] flex-wrap gap-x-6 px-5 pb-8 sm:px-8"
    >
      {links.map((link) => (
        <Link key={link.to} to={link.to} className={LINK}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The frame of the buyer's pages: the event, checkout and the order (design PD-78). The guest
 * pages' Ivory system, not the app's kit: a single column, mobile first (C-8), and the Aveline
 * mark once, at the foot (C-12).
 */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div data-theme="ivory" className="bg-surface text-text flex min-h-svh flex-col">
      <main className="mx-auto flex w-full max-w-[40rem] flex-auto flex-col gap-10 px-5 pt-8 pb-16 sm:px-8">
        {children}
      </main>
      <PublicLinks />
      <FooterMark />
    </div>
  );
}
