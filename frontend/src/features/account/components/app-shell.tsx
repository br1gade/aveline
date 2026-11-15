import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useNavigation } from 'react-router';

import { browserSession } from '@/api/session';
import { LANGUAGES, type Language } from '@/lib/i18n';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';
import { cx, Icon, LanguageSwitcher } from '@/ui';
import { LEAVE_UNASKED, MoreActions } from '@/ui/app-form';
import { Alert, AlertDescription } from '@/ui/kit/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/ui/kit/alert-dialog';
import { Button } from '@/ui/kit/button';

import { EmailConfirmationNotice } from './email-confirmation-notice';

/** Wherever the session ends, here, in another tab or by a refused refresh, go to sign in. */
function useSignInWhenSignedOut() {
  const navigate = useNavigate();
  useEffect(
    () =>
      browserSession().onSignedOut(() => {
        // Nothing can be saved any more, so unsaved changes don't hold the page.
        void navigate(ROUTE_PATHS.signIn, { replace: true, state: LEAVE_UNASKED });
      }),
    [navigate],
  );
}

/** "Every device" is drastic and cannot be undone, so it asks first. */
function SignOutEverywhere({ onFailed }: { onFailed: () => void }) {
  const { t } = useTranslation('app');
  const signOutEverywhere = () => {
    browserSession().signOutEverywhere().catch(onFailed);
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost">{t('shell.signOutEverywhere')}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('shell.confirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('shell.confirm.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('shell.confirm.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={signOutEverywhere}>
            {t('shell.confirm.action')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * While the next page loads after a click. The first load shows `AppLoading` instead. The status is
 * always there, empty when idle, so a screen reader announces it when it fills.
 */
function NavigationStatus() {
  const { t } = useTranslation('app');
  const isLoading = useNavigation().state === 'loading';
  return (
    <p
      role="status"
      className="text-muted-foreground absolute top-2 right-4 m-0 text-sm sm:right-8"
    >
      {isLoading ? t('shell.loading') : ''}
    </p>
  );
}

/** Which organization this tab works in, for an account with several (design PD-138). */
function CurrentOrganization({ name }: { name: string | null }) {
  const { t } = useTranslation('app');
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm">
      {name ? <span className="break-words">{t('organizations.current', { name })}</span> : null}
      <Link
        to={APP_PATHS.organizations}
        className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline"
      >
        {t('organizations.change')}
      </Link>
    </p>
  );
}

/**
 * `compact`: a page used one-handed on a phone, the door: one row of header with everything but the
 * wordmark in a menu, no address notice, and less space above the page (design PD-90).
 * `wide`: a long list read on a desktop, the guests and the seating, which takes the screen's width
 * from `lg` (design PD-199).
 */
export type ShellFrame = 'compact' | 'wide';

const MAIN_WIDTH = 'max-w-[56rem]';
const WIDE_MAIN_WIDTH = 'max-w-[56rem] lg:max-w-[80rem]';

interface AppShellProps {
  children: ReactNode;
  /** Shown only to an account with several: one organization needs no saying. */
  organization?: { name: string | null } | undefined;
  /** The account's address while it is not confirmed (FR-5); nothing once it is. */
  unverifiedEmail?: string | null | undefined;
  /** The frame a page asks for in its route `handle`; the standard one otherwise. */
  frame?: ShellFrame | undefined;
}

/** The language, the organization and signing out: in the header, or in the compact menu. */
function AccountControls({ organization }: Pick<AppShellProps, 'organization'>) {
  const { t, i18n } = useTranslation('app');
  const location = useLocation();
  const [hasSignOutFailed, setHasSignOutFailed] = useState(false);
  // The rest of the query stays, so a language switch keeps the guest list's search and filter.
  const hrefFor = (language: Language) => {
    const query = new URLSearchParams(location.search);
    query.set('lang', language);
    return `${location.pathname}?${query.toString()}`;
  };
  return (
    <>
      {organization ? <CurrentOrganization name={organization.name} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <LanguageSwitcher
          current={i18n.language}
          available={LANGUAGES}
          hrefFor={hrefFor}
          isClientNavigation
          align="end"
        />
        <SignOutEverywhere onFailed={() => setHasSignOutFailed(true)} />
        <Button variant="outline" onClick={() => void browserSession().signOut()}>
          {t('shell.signOut')}
        </Button>
      </div>
      {hasSignOutFailed ? (
        <Alert variant="destructive" className="basis-full">
          <Icon name="circle-alert" size={16} />
          <AlertDescription>{t('shell.signOutFailed')}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

/** The compact header's menu (design PD-90). */
function CompactMenu({ organization }: Pick<AppShellProps, 'organization'>) {
  const { t } = useTranslation('app');
  return (
    <MoreActions
      label={t('shell.menu')}
      panelClassName="absolute top-full right-0 z-20 mt-2 w-max max-w-[calc(100vw-2rem)] items-start gap-3 p-4 shadow-sm"
    >
      <AccountControls organization={organization} />
    </MoreActions>
  );
}

/** The signed-in app's frame: the wordmark, the language, and signing out (design PD-39). */
export function AppShell({ children, organization, unverifiedEmail, frame }: AppShellProps) {
  const { t: common } = useTranslation('common');
  const isCompact = frame === 'compact';
  useSignInWhenSignedOut();

  return (
    <div className="bg-background text-foreground min-h-svh text-[15px] leading-[22px]">
      <a
        href="#content"
        className="bg-background text-primary sr-only z-30 p-3 underline focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        {common('skipToContent')}
      </a>
      <header
        className={cx(
          'border-border flex items-center justify-between gap-3 border-b px-4 sm:px-8',
          isCompact ? 'py-2' : 'flex-wrap py-3',
        )}
      >
        <p className="text-primary m-0 font-serif text-lg tracking-[0.24em] uppercase">
          {common('appName')}
        </p>
        {isCompact ? (
          <CompactMenu organization={organization} />
        ) : (
          <AccountControls organization={organization} />
        )}
      </header>
      <main
        id="content"
        tabIndex={-1}
        className={cx(
          'relative mx-auto flex w-full flex-col px-4 sm:px-8',
          frame === 'wide' ? WIDE_MAIN_WIDTH : MAIN_WIDTH,
          isCompact ? 'gap-4 py-4' : 'gap-6 py-8',
        )}
      >
        <NavigationStatus />
        {unverifiedEmail && !isCompact ? <EmailConfirmationNotice email={unverifiedEmail} /> : null}
        {children}
      </main>
    </div>
  );
}

/** What the server renders for a signed-in page: the session is read in the browser. */
export function AppLoading() {
  const { t } = useTranslation('app');
  return (
    <div className="bg-background text-muted-foreground flex min-h-svh items-center justify-center">
      <p role="status">{t('shell.loading')}</p>
    </div>
  );
}
