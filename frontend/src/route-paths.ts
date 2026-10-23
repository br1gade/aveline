/**
 * Client paths the backend builds into emails and messages from PUBLIC_APP_URL (setup proposal
 * §5.3). Renaming one breaks every link already sent: it needs a backend change in the same
 * release, and FR-8 asks for this table in docs/API.md. Pinned by route-paths.test.ts.
 */
export const ROUTE_PATHS = {
  /** backend/src/modules/invitations/sending/ */
  guestInvitation: '/invitations/:slug/g/:guestToken',
  genericInvitation: '/invitations/:slug',
  /** backend/src/infra/auth/account.service.ts */
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  acceptInvite: '/accept-invite',
  /** backend/src/modules/ticketing/ticket-notifier.service.ts */
  ticket: '/tickets/:accessToken',
  /** Built by the client (docs/API.md §6). */
  brief: '/briefs/:briefToken',
} as const;
