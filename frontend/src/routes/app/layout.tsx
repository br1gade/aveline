import { Outlet, useLoaderData, useMatches, type ShouldRevalidateFunctionArgs } from 'react-router';

import { loaded } from '@/api/loaded';
import {
  AppLoading,
  AppShell,
  readAccountOnce,
  requireOrganizationChosen,
  requireSignedIn,
  type ShellFrame,
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

function isShellFrame(value: unknown): value is ShellFrame {
  return value === 'compact' || value === 'wide';
}

/** The frame a page under the app asks for in its `handle`, as the door and the guests do. */
function frameOf(handle: unknown): ShellFrame | undefined {
  if (typeof handle !== 'object' || handle === null || !('shell' in handle)) return undefined;
  return isShellFrame(handle.shell) ? handle.shell : undefined;
}

export default function AppLayout() {
  const { organization, unverifiedEmail } = useLoaderData<typeof clientLoader>();
  const frame = useMatches()
    .map((match) => frameOf(match.handle))
    .findLast(Boolean);
  return (
    <LeaveGuard>
      <AppShell organization={organization} unverifiedEmail={unverifiedEmail} frame={frame}>
        <Outlet />
      </AppShell>
    </LeaveGuard>
  );
}
