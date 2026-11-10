// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ORGANIZATION_HEADER, takesOrganization } from './organization-scope';

const BACKEND = join(import.meta.dirname, '../../../backend/src');
const SPEC = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../backend/openapi.json'), 'utf8'),
) as { paths: Record<string, Record<string, { parameters?: { in?: string; name?: string }[] }>> };

/**
 * The operations the spec says may select an organization (FR-116), less those that name their own
 * through an event or an invitation, where another organization is a 409, and staff's own, which
 * choose a customer's. The spec doesn't tell those apart yet (FR-146), so their paths do.
 */
function selectingOperations(): { method: string; path: string }[] {
  return Object.entries(SPEC.paths).flatMap(([path, operations]) =>
    Object.entries(operations)
      .filter(([, operation]) =>
        (operation.parameters ?? []).some(
          (parameter) =>
            parameter.in === 'header' && parameter.name?.toLowerCase() === ORGANIZATION_HEADER,
        ),
      )
      .filter(() => !/\/(events|invitations)\/\{|\/(concierge|sales)\//.test(path))
      .map(([method]) => ({
        method: method.toUpperCase(),
        path: path.replaceAll(/\{\w+\}/g, 'x'),
      })),
  );
}

function controllers(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return controllers(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

interface Route {
  method: string;
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
      const route = /@(Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/.exec(decorators);
      if (!route?.[1] || scope?.[1]?.includes('platform')) return [];
      const path = [prefix, route[2]].filter(Boolean).join('/').replaceAll(/:\w+/g, 'x');
      return [
        { method: route[1].toUpperCase(), path: `/api/v1/${path}`, isScoped: Boolean(scope) },
      ];
    });
  });
}

const scopedRoutes = routes().filter(({ isScoped }) => isScoped);
const otherRoutes = routes().filter(({ isScoped }) => !isScoped);

describe('which calls say which organization', () => {
  it('finds the routes it is pinned to', () => {
    expect(scopedRoutes.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['/api/v1/subscription', '/api/v1/promo-codes', '/api/v1/events']),
    );
    expect(otherRoutes.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['/api/v1/plans', '/api/v1/me/organizations']),
    );
  });

  it('reads each handler apart, not one per file', () => {
    expect(scopedRoutes.filter(({ path }) => path.startsWith('/api/v1/promo-codes'))).toHaveLength(
      4,
    );
  });

  it.each(scopedRoutes)(
    'sends it to $method $path, which the backend scopes',
    ({ path, method }) => {
      expect(takesOrganization(path, method)).toBe(true);
    },
  );

  it.each(otherRoutes)(
    'keeps it from $method $path, which the backend doesn’t scope',
    ({ path, method }) => {
      expect(takesOrganization(path, method)).toBe(false);
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
    expect(takesOrganization(path, 'GET')).toBe(false);
  });
});

describe('the header the spec declares (FR-116)', () => {
  it('declares it somewhere, so the next test reads something', () => {
    expect(selectingOperations().length).toBeGreaterThan(30);
  });

  it.each(selectingOperations())('sends it to $method $path', ({ method, path }) => {
    expect(takesOrganization(path, method)).toBe(true);
  });
});
