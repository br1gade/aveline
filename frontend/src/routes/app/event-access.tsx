import { Outlet, type ShouldRevalidateFunctionArgs } from 'react-router';

import { requireSignedIn } from '@/features/account';
import { GrantedPermissions, readEventAccess } from '@/features/permissions';

import type { Route } from './+types/event-access';

/**
 * What the caller may do on this event (FR-6), for every page of it. Read once per event, and again
 * when a page reads itself again after a write, which may have changed the caller's own role; a role
 * changed by someone else mid-visit meets the action's own worded 403 (design PD-190).
 */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return { permissions: await readEventAccess(api, params.eventId) };
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  currentParams,
  nextParams,
}: ShouldRevalidateFunctionArgs) {
  return currentParams.eventId !== nextParams.eventId || currentUrl.href === nextUrl.href;
}

export default function EventAccess({ loaderData }: Route.ComponentProps) {
  return (
    <GrantedPermissions permissions={loaderData.permissions}>
      <Outlet />
    </GrantedPermissions>
  );
}
