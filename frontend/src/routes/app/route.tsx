import { Outlet } from 'react-router';

import { negotiatedLanguageData, negotiatedLanguageHandle, passLoaderHeaders } from '@/lib/i18n';

import type { Route } from './+types/route';

/**
 * The `/app` segment, and its language (PD-40). It is a route of its own because the layout under
 * it checks the session on hydration, and a route that does so has no loader data in the server
 * render: the language must come from here for `<html lang>` and the loading state to be right.
 */
export function loader({ request }: Route.LoaderArgs) {
  return negotiatedLanguageData(request);
}

export const headers = passLoaderHeaders;
export const handle = negotiatedLanguageHandle;

export default function AppSegment() {
  return <Outlet />;
}
