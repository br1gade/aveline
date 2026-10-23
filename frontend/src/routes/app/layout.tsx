import { Outlet } from 'react-router';

import { AppLoading, AppShell, requireSignedIn } from '@/features/account';

import type { Route } from './+types/layout';

/**
 * The signed-in app. The server knows no session, so it renders the loading state; the browser
 * checks the session and renders the page (setup proposal §5.2). The language comes from the
 * `/app` route above.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireSignedIn(request);
  return null;
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <AppLoading />;
}

export default function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
