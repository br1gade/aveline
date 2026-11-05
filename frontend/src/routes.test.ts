// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const source = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('the pages and their ways in', () => {
  it.each([
    ['organization', 'routes/app/organization.tsx'],
    ['activity', 'routes/app/activity.tsx'],
    ['privacyRequest', 'routes/public/privacy-request.tsx'],
  ])('%s is a route, to its own file', (path, file) => {
    expect(source('routes.ts')).toContain(`APP_PATHS.${path}), '${file}'`);
  });

  it.each([
    ['routes/app/home.tsx', 'APP_PATHS.organization'],
    ['routes/home.tsx', 'APP_PATHS.privacyRequest'],
    ['features/account/components/sign-in.tsx', 'APP_PATHS.privacyRequest'],
    ['features/billing/components/pricing-page.tsx', 'APP_PATHS.privacyRequest'],
    ['features/events/components/event-overview.tsx', 'activityPath(event.id)'],
  ])('%s leads to it', (file, link) => {
    expect(source(file)).toContain(link);
  });
});
