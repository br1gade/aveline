/**
 * Client paths the backend builds from PUBLIC_APP_URL, into emails and messages and as the bank's
 * default return pages (setup proposal §5.3). Renaming one breaks every link already sent: it
 * needs a backend change in the same release, and FR-8 asks for this table in docs/API.md. Pinned
 * by route-paths.test.ts.
 */
export const ROUTE_PATHS = {
  /** backend/src/modules/invitations/sending/ */
  guestInvitation: '/invitations/:slug/g/:guestToken',
  genericInvitation: '/invitations/:slug',
  /** backend/src/infra/auth/account.service.ts */
  signIn: '/sign-in',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  acceptInvite: '/accept-invite',
  acceptEventInvite: '/accept-event-invite',
  /** backend/src/modules/ticketing/ticket-notifier.service.ts */
  ticket: '/tickets/:accessToken',
  /** The bank's default return pages: ticketing.service.ts and billing/subscriptions.service.ts */
  ticketPaymentReturn: '/tickets/return',
  billingPaymentReturn: '/billing/return',
  /** Built by the client (docs/API.md §6). */
  brief: '/briefs/:briefToken',
} as const;

/** The client's own paths. Nothing outside the client links to them, so they are free to rename. */
export const APP_PATHS = {
  register: '/register',
  app: '/app',
  welcome: '/app/welcome',
} as const;
