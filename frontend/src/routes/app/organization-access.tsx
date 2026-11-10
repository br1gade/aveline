import { Outlet, type ShouldRevalidateFunctionArgs } from 'react-router';

import { requireSignedIn } from '@/features/account';
import { GrantedPermissions, readOrganizationAccess } from '@/features/permissions';
import { APP_PATHS } from '@/route-paths';

import type { Route } from './+types/organization-access';

/**
 * What the caller may do in the organization this tab works in (FR-6), for its own pages. Read when
 * they are entered (choosing another organization leaves them first), when a page reads itself again
 * after a write, and on leaving the organization's own page, where the caller's own membership may
 * have changed or ended (design PD-190).
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return { permissions: await readOrganizationAccess(api) };
}

export function shouldRevalidate({ currentUrl, nextUrl }: ShouldRevalidateFunctionArgs) {
  return currentUrl.href === nextUrl.href || currentUrl.pathname === APP_PATHS.organization;
}

export default function OrganizationAccess({ loaderData }: Route.ComponentProps) {
  return (
    <GrantedPermissions permissions={loaderData.permissions}>
      <Outlet />
    </GrantedPermissions>
  );
}
