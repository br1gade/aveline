/**
 * Which calls say which organization (`X-Aveline-Organization-Id`, docs/API.md §6). Only those the
 * backend scopes to one: an event or an invitation names its own, and an authorized selection of
 * another is a 409, which would refuse an event the account was invited onto from elsewhere.
 * **A temporary stand-in** (design PD-138, FR-116): nothing declares this per route, so this list is
 * pinned by a test that reads the backend's controllers.
 */
export const ORGANIZATION_HEADER = 'x-aveline-organization-id';

const SCOPED_PATHS: readonly RegExp[] = [
  /^\/api\/v1\/events$/,
  /^\/api\/v1\/subscription(\/|$)/,
  /^\/api\/v1\/invoices(\/|$)/,
  /^\/api\/v1\/promo-codes(\/|$)/,
  /^\/api\/v1\/suppressions(\/|$)/,
  /^\/api\/v1\/vendors$/,
  /^\/api\/v1\/organization\/invites(\/|$)/,
  /^\/api\/v1\/organizations\/current(\/|$)/,
];

export function takesOrganization(pathname: string): boolean {
  return SCOPED_PATHS.some((path) => path.test(pathname));
}
