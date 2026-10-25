import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useNavigation } from 'react-router';

import { browserSession } from '@/api/session';
import { LANGUAGES, type Language } from '@/lib/i18n';
import { ROUTE_PATHS } from '@/route-paths';
import { Icon, LanguageSwitcher } from '@/ui';
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

/** Wherever the session ends, here, in another tab or by a refused refresh, go to sign in. */
function useSignInWhenSignedOut() {
  const navigate = useNavigate();
  useEffect(
    () =>
      browserSession().onSignedOut(() => {
        void navigate(ROUTE_PATHS.signIn, { replace: true });
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

/** The signed-in app's frame: the wordmark, the language, and signing out (design PD-39). */
export function AppShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation('app');
  const { t: common } = useTranslation('common');
  const location = useLocation();
  const [hasSignOutFailed, setHasSignOutFailed] = useState(false);
  useSignInWhenSignedOut();
  // The rest of the query stays, so a language switch keeps the guest list's search and filter.
  const hrefFor = (language: Language) => {
    const query = new URLSearchParams(location.search);
    query.set('lang', language);
    return `${location.pathname}?${query.toString()}`;
  };

  return (
    <div className="bg-background text-foreground min-h-svh text-[15px] leading-[22px]">
      <header className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-8">
        <p className="text-primary m-0 font-serif text-lg tracking-[0.24em] uppercase">
          {common('appName')}
        </p>
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
      </header>
      <main className="relative mx-auto flex w-full max-w-[56rem] flex-col gap-6 px-4 py-8 sm:px-8">
        <NavigationStatus />
        {hasSignOutFailed ? (
          <Alert variant="destructive">
            <Icon name="circle-alert" size={16} />
            <AlertDescription>{t('shell.signOutFailed')}</AlertDescription>
          </Alert>
        ) : null}
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
