import { accountMeta, VerifyEmail } from '@/features/account';
import {
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
} from '@/lib/i18n';

import type { Route } from './+types/verify-email';

/** Opened from an emailed `?token=` link: entry.server.tsx keeps it out of caches and referrers. */
export function loader({ request }: Route.LoaderArgs) {
  return negotiatedLanguageData(request);
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  return accountMeta('verifyEmail', languageOf(loaderData));
}

export default function Page() {
  return <VerifyEmail />;
}
