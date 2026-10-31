import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GUEST_PAGE_LIMITS } from './throttler.guard';

/**
 * Which routes get the wide guest-page allowance (docs/API.md §1 Rate limits).
 *
 * Read from the decorators of every controller in the codebase, so a looser
 * @Throttle added to a new route — a write especially — fails here rather
 * than quietly widening what a script can do to a public endpoint.
 */
interface Route { method: RequestMethod; path: string; short?: number; medium?: number }

const SOURCE_ROOT = join(__dirname, '..', '..');

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

const joined = (...parts: unknown[]) =>
  parts.filter((part): part is string => typeof part === 'string' && part !== '' && part !== '/').map((part) => part.replace(/^\/|\/$/g, '')).join('/');

function routesOf(controller: { prototype: object }): Route[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as unknown;
  return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
    const handler = (controller.prototype as Record<string, unknown>)[name];
    if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) return [];
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
    const limit = (window: string) =>
      (Reflect.getMetadata(`THROTTLER:LIMIT${window}`, handler) ?? Reflect.getMetadata(`THROTTLER:LIMIT${window}`, controller)) as number | undefined;
    return [{ method, path: joined(base, Reflect.getMetadata(PATH_METADATA, handler)), short: limit('short'), medium: limit('medium') }];
  });
}

describe('guest-page rate limits', () => {
  let routes: Route[];

  beforeAll(async () => {
    const modules = await Promise.all(controllerFiles(SOURCE_ROOT).map((file) => import(file) as Promise<Record<string, unknown>>));
    const controllers = modules.flatMap((exported) => Object.values(exported))
      .filter((value): value is { prototype: object } => typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value) !== undefined);
    routes = controllers.flatMap(routesOf);
  });

  it('finds the codebase\'s routes', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('widens exactly the documented guest-page reads to 50/s and 3,000/min', () => {
    const widened = routes.filter((route) => route.short !== undefined || route.medium !== undefined);

    expect(widened.map((route) => route.path).sort()).toEqual([
      'events/:eventId/acknowledgements/:acknowledgementId/file',
      'events/:eventId/gallery/:mediaId/file',
      'invitations/:slug',
      'invitations/:slug/g/:guestToken',
      'invitations/:slug/g/:guestToken/acknowledgements/:acknowledgementId/file',
      'invitations/:slug/g/:guestToken/gallery/:mediaId/file',
      'invitations/:slug/g/:guestToken/rsvp',
      'invitations/:slug/g/:guestToken/signature-uploads/:mediaId/file',
    ]);
    for (const route of widened) {
      expect(route).toMatchObject({ method: RequestMethod.GET, short: GUEST_PAGE_LIMITS.short.limit, medium: GUEST_PAGE_LIMITS.medium.limit });
    }
  });

  it('pins the allowance itself at 50 per second and 3,000 per minute', () => {
    expect(GUEST_PAGE_LIMITS).toEqual({ short: { limit: 50, ttl: 1000 }, medium: { limit: 3000, ttl: 60_000 } });
  });

  it('leaves every write on the default limit, the guest RSVP submit included', () => {
    const writes = routes.filter((route) => route.method !== RequestMethod.GET);

    expect(writes.some((route) => route.method === RequestMethod.POST && route.path === 'invitations/:slug/g/:guestToken/rsvp')).toBe(true);
    expect(writes.filter((route) => route.short !== undefined || route.medium !== undefined)).toEqual([]);
  });
});
