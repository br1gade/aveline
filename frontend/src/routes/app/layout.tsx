import { Outlet, useLoaderData, type ShouldRevalidateFunctionArgs } from 'react-router';

import {
  AppLoading,
  AppShell,
  requireOrganizationChosen,
  requireSignedIn,
} from '@/features/account';
import { QuestionsLeftOnNotice } from '@/features/events';
import { revalidateUnlessQueryOnly } from '@/lib/routing';
import { APP_PATHS } from '@/route-paths';
import { LeaveGuard } from '@/ui/app-form';

import type { Route } from './+types/layout';

/**
 * The signed-in app. The server knows no session, so it renders the loading state; the browser
 * checks the session and renders the page (setup proposal §5.2). The language comes from the
 * `/app` route above.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  const settled = await requireOrganizationChosen(api, new URL(request.url));
  return settled?.canChange ? { name: settled.current?.name ?? null } : null;
}
clientLoader.hydrate = true as const;

/**
 * A search or a filter on the same page needs no new session check. Leaving the chooser reads it
 * again, as it names the organization chosen.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return args.currentUrl.pathname === APP_PATHS.organizations || revalidateUnlessQueryOnly(args);
}

export function HydrateFallback() {
  return <AppLoading />;
}

export default function AppLayout() {
  const organization = useLoaderData<typeof clientLoader>();
  return (
    <LeaveGuard>
      <AppShell organization={organization ?? undefined}>
        <QuestionsLeftOnNotice />
        <Outlet />
      </AppShell>
    </LeaveGuard>
  );
}
