// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_PATHS } from './route-paths';
import routes from './routes';

const SRC = import.meta.dirname;
const source = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('the pages and their ways in', () => {
  it.each([
    ['APP_PATHS.organization', 'routes/app/organization.tsx'],
    ['APP_PATHS.activity', 'routes/app/activity.tsx'],
    ['ROUTE_PATHS.privacyRequest', 'routes/public/privacy-request.tsx'],
    ['APP_PATHS.help', 'routes/public/help.tsx'],
    ['APP_PATHS.staff', 'routes/app/staff.tsx'],
    ['APP_PATHS.staffCustomers', 'routes/app/staff-customers.tsx'],
    ['APP_PATHS.staffNewEvent', 'routes/app/staff-new-event.tsx'],
    ['APP_PATHS.staffDataRequests', 'routes/app/staff-data-requests.tsx'],
    ['APP_PATHS.staffAccessReviews', 'routes/app/staff-access-reviews.tsx'],
  ])('%s is a route, to its own file', (path, file) => {
    expect(source('routes.ts')).toContain(`${path}), '${file}'`);
  });

  it.each([
    ['routes/app/home.tsx', 'APP_PATHS.organization'],
    ['routes/app/home.tsx', 'APP_PATHS.staff'],
    ['features/customers/components/staff-home.tsx', 'APP_PATHS.staffAccessReviews'],
    ['routes/home.tsx', 'ROUTE_PATHS.privacyRequest'],
    ['features/account/components/sign-in.tsx', 'ROUTE_PATHS.privacyRequest'],
    ['features/billing/components/pricing-page.tsx', 'ROUTE_PATHS.privacyRequest'],
    ['routes/home.tsx', 'APP_PATHS.help'],
    ['features/account/components/sign-in.tsx', 'APP_PATHS.help'],
    ['features/billing/components/pricing-page.tsx', 'APP_PATHS.help'],
    ['routes/app/home.tsx', 'APP_PATHS.help'],
    ['features/events/components/event-overview.tsx', 'activityPath(event.id)'],
  ])('%s leads to it', (file, link) => {
    expect(source(file)).toContain(link);
  });
});

interface RouteEntry {
  file: string;
  path?: string | undefined;
  children?: RouteEntry[] | undefined;
}

/** Each page's file, with the layouts above it. */
function pagesWithLayouts(
  entries: readonly RouteEntry[],
  above: string[] = [],
): Map<string, string[]> {
  const pages = new Map<string, string[]>();
  for (const entry of entries) {
    pages.set(entry.file, above);
    for (const [file, layouts] of pagesWithLayouts(entry.children ?? [], [...above, entry.file])) {
      pages.set(file, layouts);
    }
  }
  return pages;
}

describe('what each page may offer (FR-6, design PD-190)', () => {
  const pages = pagesWithLayouts(routes);
  const routeFile = (path: string) =>
    new RegExp(`APP_PATHS\\.${path}\\), '([^']+)'`).exec(source('routes.ts'))?.[1] ?? '';
  const eventPages = Object.entries(APP_PATHS)
    .filter(([, path]) => path.startsWith('/app/events/:eventId'))
    .map(([name]) => routeFile(name))
    .filter((file) => !(pages.get(file) ?? []).includes('routes/app/preview-layout.tsx'));

  it('finds the event’s pages, so the next test reads something', () => {
    expect(eventPages.length).toBeGreaterThan(30);
  });

  it.each(eventPages)('%s reads the event’s permissions', (file) => {
    expect(pages.get(file)).toContain('routes/app/event-access.tsx');
  });

  it.each([
    'routes/app/home.tsx',
    'routes/app/organization.tsx',
    'routes/app/suppressions.tsx',
    'routes/app/billing.tsx',
    'routes/app/promo-codes.tsx',
    'routes/app/vendors.tsx',
  ])('%s reads the organization’s permissions', (file) => {
    expect(pages.get(file)).toContain('routes/app/organization-access.tsx');
  });
});
