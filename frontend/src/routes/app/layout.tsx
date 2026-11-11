import { Outlet, useLoaderData, type ShouldRevalidateFunctionArgs } from 'react-router';

import { loaded } from '@/api/loaded';
import {
  AppLoading,
  AppShell,
  readAccountOnce,
  requireOrganizationChosen,
  requireSignedIn,
} from '@/features/account';
import { revalidateUnlessQueryOnly } from '@/lib/routing';
import { APP_PATHS } from '@/route-paths';
import { LeaveGuard } from '@/ui/app-form';

import type { Route } from './+types/layout';

/**
 * The signed-in app. The server knows no session, so it renders the loading state; the browser
 * checks the session and renders the page (setup proposal §5.2). The language comes from the
 * `/app` route above. Who is signed in is read beside it (FR-5); if that fails, the page stands
 * without the address notice.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  const [settled, account] = await Promise.all([
    requireOrganizationChosen(api, new URL(request.url)),
    loaded(readAccountOnce(api)),
  ]);
  const isUnverified = account.kind === 'ready' && !account.value.isEmailVerified;
  return {
    organization: settled?.canChange ? { name: settled.current?.name ?? null } : undefined,
    unverifiedEmail: isUnverified ? account.value.email : null,
  };
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
  const { organization, unverifiedEmail } = useLoaderData<typeof clientLoader>();
  return (
    <LeaveGuard>
      <AppShell organization={organization} unverifiedEmail={unverifiedEmail}>
        <Outlet />
      </AppShell>
    </LeaveGuard>
  );
}
