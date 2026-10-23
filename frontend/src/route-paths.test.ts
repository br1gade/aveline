import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROUTE_PATHS } from './route-paths';

// Read only: the frontend checks that the backend still builds these paths.
const backendSource = join(import.meta.dirname, '..', '..', 'backend', 'src');
const backend = (path: string) => readFileSync(join(backendSource, path), 'utf8');

describe('the route contract', () => {
  it('pins every path the backend emails', () => {
    expect(ROUTE_PATHS).toEqual({
      guestInvitation: '/invitations/:slug/g/:guestToken',
      genericInvitation: '/invitations/:slug',
      resetPassword: '/reset-password',
      verifyEmail: '/verify-email',
      acceptInvite: '/accept-invite',
      ticket: '/tickets/:accessToken',
      brief: '/briefs/:briefToken',
    });
  });

  it('matches the paths the backend actually builds', () => {
    const account = backend('infra/auth/account.service.ts');
    for (const path of [
      ROUTE_PATHS.resetPassword,
      ROUTE_PATHS.verifyEmail,
      ROUTE_PATHS.acceptInvite,
    ]) {
      expect(account).toContain(path);
    }
    expect(backend('modules/ticketing/ticket-notifier.service.ts')).toContain('/tickets/');
    expect(backend('modules/invitations/sending/invitation-sender.service.ts')).toContain(
      '/invitations/${slug}/g/${token}',
    );
  });
});
