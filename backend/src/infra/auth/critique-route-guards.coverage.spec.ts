import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { EVENT_SCOPE, IS_PUBLIC, ORGANIZATION_SCOPE, REQUIRED_PERMISSION } from './actor';

/**
 * The guard rules, checked across every controller rather than route by route
 * (GOING_LIVE.md §3: "authorization and tenant scoping, tested at both
 * outcomes"). AuthGuard admits a route with no @RequirePermission to anyone
 * signed in, and a route with no @EventScope never loads the caller's standing
 * on the event in its URL — both are omissions nobody sees in review.
 */
interface Route {
  route: string;
  isPublic: boolean;
  permission?: string;
  eventScope?: string;
  organizationScope?: unknown;
}

const SOURCE_ROOT = join(__dirname, '..', '..');

type Decorated = (...args: unknown[]) => unknown;

function routeOf(controller: Decorated, handler: Decorated): Route {
  const metadata = (key: string): unknown => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
  const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
  const path = [Reflect.getMetadata(PATH_METADATA, controller), Reflect.getMetadata(PATH_METADATA, handler)]
    .map(String).filter((part) => part !== '' && part !== '/').join('/');
  return {
    route: `${method} /${path}`,
    isPublic: metadata(IS_PUBLIC) === true,
    permission: metadata(REQUIRED_PERMISSION) as string | undefined,
    eventScope: metadata(EVENT_SCOPE) as string | undefined,
    organizationScope: metadata(ORGANIZATION_SCOPE),
  };
}

function routesOf(controller: Decorated): Route[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype).flatMap((name) => {
    const handler = prototype[name];
    if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) return [];
    return [routeOf(controller, handler as Decorated)];
  });
}

function allRoutes(): Route[] {
  return globSync('**/*.controller.ts', { cwd: SOURCE_ROOT }).flatMap((file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- every controller file, discovered at run time, so a new one cannot be forgotten
    const exported = require(join(SOURCE_ROOT, file)) as Record<string, unknown>;
    return Object.values(exported).flatMap((value) =>
      typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value) !== undefined ? routesOf(value as Decorated) : []);
  });
}

/**
 * Routes that need a session and nothing else, each because the caller acts
 * on their own account or the service itself refuses everyone else. Adding to
 * this list is a decision: say why beside the route.
 */
const SIGN_IN_ONLY = [
  'POST /auth/verify-email', // the caller's own address
  'POST /auth/logout-everywhere', // the caller's own sessions
  'POST /devices', // the caller's own device
  'DELETE /devices/:token', // only a device of the caller's own; any other is 404
  'GET /me/organizations', // the caller's own memberships
  'POST /organizations', // anyone may open an organization of their own
  'POST /organizations/current/leave', // self-leave is open to every member
  'POST /organizations/current/closure-reviews', // organization-scoped; the service requires ownership
  'GET /events', // organization-scoped event list, filtered to event:read
  'GET /admin/organization-access-reviews', // the service requires a platform ADMIN
  'POST /admin/organization-access-reviews/:reviewId/resolve', // the service requires a platform ADMIN
].sort();

describe('route guard rules across every controller', () => {
  const routes = allRoutes();

  it('discovers the controllers, including routes it is known to guard', () => {
    expect(routes.length).toBeGreaterThan(200);
    expect(routes.map((entry) => entry.route)).toEqual(expect.arrayContaining([
      'GET /events/:eventId/dashboard', 'POST /invitations/:slug/thank-you', 'POST /ticket-orders/release-expired',
    ]));
  });

  it('marks every route either @Public or with a permission, except the reviewed sign-in-only ones', () => {
    const signInOnly = routes.filter((entry) => !entry.isPublic && !entry.permission).map((entry) => entry.route).sort();

    expect(signInOnly).toEqual(SIGN_IN_ONLY);
  });

  it('scopes every non-public route naming :eventId to that event', () => {
    const unscoped = routes.filter((entry) => !entry.isPublic && entry.route.includes(':eventId') && entry.eventScope !== 'eventId');

    expect(unscoped.map((entry) => entry.route)).toEqual([]);
  });

  it('scopes every permissioned route naming an invitation or listing :slug to its event', () => {
    const unscoped = routes.filter((entry) => !entry.isPublic && entry.permission && entry.route.includes(':slug')
      && entry.eventScope !== 'invitationSlug' && entry.eventScope !== 'listingSlug');

    expect(unscoped.map((entry) => entry.route)).toEqual([]);
  });

  it('scopes every non-public route naming :organizationId to an organization', () => {
    const unscoped = routes.filter((entry) => !entry.isPublic && entry.route.includes(':organizationId') && entry.organizationScope === undefined);

    expect(unscoped.map((entry) => entry.route)).toEqual([]);
  });

  it('never marks a route both @Public and permissioned, which would silently drop the permission', () => {
    expect(routes.filter((entry) => entry.isPublic && entry.permission).map((entry) => entry.route)).toEqual([]);
  });
});
