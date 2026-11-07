import '@/locales/public';
import { data } from 'react-router';

import { privacyRequestMeta, PrivacyRequestPage } from '@/features/privacy-request';
import {
  languageOf,
  negotiatedLanguageHandle,
  negotiateLanguage,
  passLoaderHeaders,
} from '@/lib/i18n';
import { checkoutHeaders } from '@/lib/security/headers';
import { LeaveGuard } from '@/ui/app-form';

import type { Route } from './+types/privacy-request';

/** For anyone, with no session: the page's language negotiated, as the price list's is. */
export function loader({ request }: Route.LoaderArgs) {
  const { language, setCookie } = negotiateLanguage(request);
  return data(
    { language },
    {
      headers: {
        // What is typed here is about a person: no copy for the Back button of a shared computer.
        ...checkoutHeaders(),
        Vary: 'Cookie, Accept-Language',
        ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
      },
    },
  );
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  return privacyRequestMeta(languageOf(loaderData) ?? 'en');
}

export default function PrivacyRequest() {
  return (
    <LeaveGuard>
      <PrivacyRequestPage />
    </LeaveGuard>
  );
}
