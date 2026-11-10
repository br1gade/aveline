import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROUTE_PATHS } from './route-paths';

// Read only: the frontend checks that the backend still builds these paths.
const backendSource = join(import.meta.dirname, '..', '..', 'backend', 'src');
const backend = (path: string) => readFileSync(join(backendSource, path), 'utf8');
const apiDoc = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'API.md'), 'utf8');

/** The paths in docs/API.md's "Browser route contract" table (FR-8). */
function documentedPaths(): string[] {
  const section = apiDoc.split('### Browser route contract')[1]?.split(/\n##+ /)[0] ?? '';
  return [...section.matchAll(/^\| `([^`?]+)(?:\?[^`]*)?` \|/gm)].map((match) => match[1] ?? '');
}

describe('the route contract', () => {
  it('pins every path the backend builds', () => {
    expect(ROUTE_PATHS).toEqual({
      guestInvitation: '/invitations/:slug/g/:guestToken',
      genericInvitation: '/invitations/:slug',
      signIn: '/sign-in',
      resetPassword: '/reset-password',
      verifyEmail: '/verify-email',
      acceptInvite: '/accept-invite',
      acceptEventInvite: '/accept-event-invite',
      ticket: '/tickets/:accessToken',
      publicEvent: '/events/:slug',
      ticketPaymentReturn: '/tickets/return',
      billingPaymentReturn: '/billing/return',
      privacyRequest: '/privacy-request',
      brief: '/briefs/:briefToken',
    });
  });

  it('is the table docs/API.md publishes, no more and no fewer', () => {
    expect(documentedPaths().toSorted()).toEqual(Object.values(ROUTE_PATHS).toSorted());
  });

  it('matches the paths the backend actually builds', () => {
    const account = backend('infra/auth/account.service.ts');
    for (const path of [
      ROUTE_PATHS.signIn,
      ROUTE_PATHS.resetPassword,
      ROUTE_PATHS.verifyEmail,
      ROUTE_PATHS.acceptInvite,
      ROUTE_PATHS.acceptEventInvite,
    ]) {
      expect(account).toContain(path);
    }
    expect(backend('modules/ticketing/ticket-notifier.service.ts')).toContain('/tickets/');
    expect(backend('modules/public-events/public-events.service.ts')).toContain(
      'canonicalPath: `/events/${listing.slug}`',
    );
    expect(backend('modules/invitations/sending/invitation-sender.service.ts')).toContain(
      '/invitations/${slug}/g/${token}',
    );
    expect(backend('modules/ticketing/ticketing.service.ts')).toContain(
      `appPage('${ROUTE_PATHS.ticketPaymentReturn}')`,
    );
    expect(backend('modules/billing/subscriptions.service.ts')).toContain(
      `appPage('${ROUTE_PATHS.billingPaymentReturn}')`,
    );
    expect(backend('modules/communications/invitation-email-footer.ts')).toContain(
      `appPage('${ROUTE_PATHS.privacyRequest}')`,
    );
  });
});
