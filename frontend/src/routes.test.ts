// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
