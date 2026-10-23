import { accountMeta, redirectIfSignedIn, Register } from '@/features/account';
import {
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
} from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import type { Route } from './+types/register';

export function loader({ request }: Route.LoaderArgs) {
  return negotiatedLanguageData(request);
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  redirectIfSignedIn(APP_PATHS.app);
  return serverLoader();
}
clientLoader.hydrate = true as const;

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  return accountMeta('register', languageOf(loaderData));
}

export default function RegisterPage() {
  return <Register />;
}
