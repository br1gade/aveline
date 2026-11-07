// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { takesOrganization } from './organization-scope';

const BACKEND = join(import.meta.dirname, '../../../backend/src');

function controllers(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return controllers(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

interface Route {
  path: string;
  isScoped: boolean;
}

/**
 * Every route, as `/api/v1/…`, staff's own aside. A handler starts a line two spaces in, and its
 * decorators come, in whatever order, between the one before and it.
 */
function routes(): Route[] {
  return controllers(BACKEND).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const prefix = /@Controller\('([^']*)'\)/.exec(source)?.[1] ?? '';
    return source.split(/^ {2}(?:async\s+)?[a-zA-Z]\w*\(/m).flatMap((decorators) => {
      const scope = /@OrganizationScope\(([^)]*)\)/.exec(decorators);
      const route = /@(?:Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/.exec(decorators);
      if (!route || scope?.[1]?.includes('platform')) return [];
      const path = [prefix, route[1]].filter(Boolean).join('/').replaceAll(/:\w+/g, 'x');
      return [{ path: `/api/v1/${path}`, isScoped: Boolean(scope) }];
    });
  });
}

const scopedRoutes = routes()
  .filter(({ isScoped }) => isScoped)
  .map(({ path }) => path);
const otherRoutes = routes()
  .filter(({ isScoped }) => !isScoped)
  .map(({ path }) => path);

describe('which calls say which organization', () => {
  it('finds the routes it is pinned to', () => {
    expect(scopedRoutes).toEqual(
      expect.arrayContaining(['/api/v1/subscription', '/api/v1/promo-codes', '/api/v1/events']),
    );
    expect(otherRoutes).toEqual(
      expect.arrayContaining(['/api/v1/plans', '/api/v1/me/organizations']),
    );
  });

  it('reads each handler apart, not one per file', () => {
    expect(scopedRoutes.filter((path) => path.startsWith('/api/v1/promo-codes'))).toHaveLength(4);
  });

  it.each(scopedRoutes)('sends it to %s, which the backend scopes', (path) => {
    expect(takesOrganization(path)).toBe(true);
  });

  it.each(otherRoutes.filter((path) => !scopedRoutes.includes(path)))(
    'keeps it from %s, which the backend doesn’t scope',
    (path) => {
      expect(takesOrganization(path)).toBe(false);
    },
  );

  it.each([
    '/api/v1/vendors/v1',
    '/api/v1/events/e1',
    '/api/v1/events/e1/guests',
    '/api/v1/events/e1/vendors',
    '/api/v1/invitations/a/design',
    '/api/v1/invitations/a/g/t',
    '/api/v1/me/organizations',
    '/api/v1/auth/login',
    '/api/v1/invites/accept',
    '/api/v1/plans',
    '/api/v1/briefs/t',
  ])('keeps it from %s: an event names its own, and a mismatch is a 409', (path) => {
    expect(takesOrganization(path)).toBe(false);
  });
});
