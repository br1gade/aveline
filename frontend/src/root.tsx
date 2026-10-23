import { useMemo, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from 'react-router';

import { isApiError } from '@/api/errors';
import { createI18n, usePageLanguage } from '@/lib/i18n';
import { createNonce } from '@/lib/security/headers';

import type { Route } from './+types/root';

import './styles/app.css';

/** A plain burgundy square until a small mark exists (design PD-2, DQ-4). */
export function links() {
  return [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }];
}

/**
 * The nonce for this response's scripts. entry.server.tsx reads it from here to write the Content
 * Security Policy, so the header and the tags always agree.
 */
export function loader() {
  return { nonce: createNonce() };
}

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root');
  const language = usePageLanguage();
  const i18n = useMemo(() => createI18n(language), [language]);

  return (
    <html lang={language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <Meta />
        <Links nonce={data?.nonce} />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        <ScrollRestoration nonce={data?.nonce} />
        <Scripts nonce={data?.nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

function requestIdOf(error: unknown): string | undefined {
  if (isApiError(error)) {
    return error.requestId;
  }
  if (isRouteErrorResponse(error)) {
    const data: unknown = error.data;
    if (typeof data === 'object' && data !== null && 'requestId' in data) {
      return typeof data.requestId === 'string' ? data.requestId : undefined;
    }
  }
  return undefined;
}

/** The last resort: shows the request id so a report maps to the exact request (API.md §1). */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation();
  const requestId = requestIdOf(error);
  return (
    <main className="mx-auto flex min-h-svh max-w-[34rem] flex-col justify-center gap-4 px-5 py-16">
      <h1 className="text-heading font-serif text-[28px] leading-[34px]">{t('error.title')}</h1>
      <p>{t('error.body')}</p>
      {requestId ? (
        <p className="text-text-muted text-sm">{t('error.reference', { requestId })}</p>
      ) : null}
    </main>
  );
}
