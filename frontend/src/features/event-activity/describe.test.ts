// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { areaOf, changeOf } from './describe';

const MODULES = join(import.meta.dirname, '../../../../backend/src/modules');

function controllers(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return controllers(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

/** Every route that writes to an event, by its id or its invitation's slug, as the trail has it. */
function eventWrites(): string[] {
  return controllers(MODULES).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const prefix = /@Controller\('([^']*)'\)/.exec(source)?.[1] ?? '';
    return [...source.matchAll(/@(?:Post|Patch|Put|Delete)\((?:'([^']*)')?\)/g)]
      .map((match) => `/${[prefix, match[1]].filter(Boolean).join('/')}`)
      .filter((route) => /^\/(?:events|invitations)\/:\w+/.test(route) && !route.includes('/g/'));
  });
}

describe('which part of an event a write touched (PD-158)', () => {
  it.each([
    ['/events/:eventId/guests/import', 'guests'],
    ['/events/:id', 'event'],
    ['/events/:id/archive', 'archive'],
    ['/events/:eventId/team/invites/:email', 'team'],
    ['/events/:eventId/attendance-policy', 'attendance-policy'],
    ['/invitations/:slug/publish', 'invitation'],
    ['/invitations/:slug/blocks/:type', 'invitation'],
  ])('%s is %s', (route, area) => {
    expect(areaOf(route)).toBe(area);
  });

  it.each([
    '/events/:eventId/something-new',
    '/invitations/:slug/g/:guestToken/rsvp',
    '',
    '/events',
  ])('names no area for %s, which is shown as it came', (route) => {
    expect(areaOf(route)).toBeNull();
  });

  it('knows every part the backend writes to', () => {
    const routes = eventWrites();
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.filter((route) => areaOf(route) === null)).toEqual([]);
  });
});

describe('what kind of write it was', () => {
  it.each([
    ['POST', 'POST'],
    ['PATCH', 'PATCH'],
    ['PUT', 'PUT'],
    ['DELETE', 'DELETE'],
    ['GET', 'OTHER'],
    ['', 'OTHER'],
  ])('%s reads as %s', (method, change) => {
    expect(changeOf(method)).toBe(change);
  });
});
