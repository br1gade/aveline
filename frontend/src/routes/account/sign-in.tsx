import { accountMeta, redirectIfSignedIn, safeNext, SignIn } from '@/features/account';
import {
  languageOf,
  negotiatedLanguageData,
  negotiatedLanguageHandle,
  passLoaderHeaders,
} from '@/lib/i18n';

import type { Route } from './+types/sign-in';

export function loader({ request }: Route.LoaderArgs) {
  return negotiatedLanguageData(request);
}

/** Someone already signed in goes where they were heading. The server render shows the form. */
export async function clientLoader({ request, serverLoader }: Route.ClientLoaderArgs) {
  redirectIfSignedIn(safeNext(new URL(request.url).searchParams.get('next')));
  return serverLoader();
}
clientLoader.hydrate = true as const;

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export function meta({ loaderData }: Route.MetaArgs) {
  return accountMeta('signIn', languageOf(loaderData));
}

export default function SignInPage() {
  return <SignIn />;
}
