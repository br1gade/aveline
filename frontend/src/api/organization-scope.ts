/**
 * Which calls say which organization (`X-Aveline-Organization-Id`, docs/API.md §6). Only those the
 * backend scopes to one: an event or an invitation names its own, and an authorized selection of
 * another is a 409, which would refuse an event the account was invited onto from elsewhere.
 * The spec now declares the header on every operation that accepts it (FR-116), but on event and
 * invitation routes too, where it must match; until it tells the two apart (FR-146) this list stays,
 * pinned by tests against the backend's controllers and the spec (design PD-138).
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

export function takesOrganization(pathname: string, method: string): boolean {
  if ((method === 'PATCH' || method === 'DELETE') && /^\/api\/v1\/vendors\/[^/]+$/.test(pathname)) {
    return true;
  }
  return SCOPED_PATHS.some((path) => path.test(pathname));
}
