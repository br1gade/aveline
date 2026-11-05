import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

import { APP_PATHS, ROUTE_PATHS } from './route-paths';

/** React Router route paths are relative to the root. */
function relative(path: string): string {
  return path.replace(/^\//, '');
}

/** A child of `/app`, relative to it. */
function underApp(path: string): string {
  return path.replace(`${APP_PATHS.app}/`, '');
}

/**
 * The route table. Paths the backend builds come from ROUTE_PATHS, the client's own from
 * APP_PATHS, never from a literal here. Route modules stay thin: loader, meta, headers, layout
 * (frontend/CLAUDE.md §6).
 */
export default [
  index('routes/home.tsx'),
  route(relative(ROUTE_PATHS.genericInvitation), 'routes/public/invitation.tsx'),
  route(relative(ROUTE_PATHS.guestInvitation), 'routes/public/guest-invitation.tsx'),
  route(relative(APP_PATHS.publicEvents), 'routes/public/events.tsx'),
  route(relative(APP_PATHS.pricing), 'routes/public/pricing.tsx'),
  route(relative(ROUTE_PATHS.publicEvent), 'routes/public/event.tsx'),
  route(relative(APP_PATHS.checkout), 'routes/public/checkout.tsx'),
  route(relative(APP_PATHS.ticketOrder), 'routes/public/ticket-order.tsx'),
  route(relative(ROUTE_PATHS.ticketPaymentReturn), 'routes/public/ticket-return.tsx'),
  route(relative(ROUTE_PATHS.ticket), 'routes/public/ticket-link.tsx'),
  route(relative(APP_PATHS.briefPage), 'routes/public/brief.tsx'),
  route(relative(ROUTE_PATHS.brief), 'routes/public/brief-link.tsx'),

  // Its language comes from the same segment as the app's: the page under it needs the session.
  route(
    relative(ROUTE_PATHS.billingPaymentReturn),
    'routes/app/route.tsx',
    { id: 'billing-return-segment' },
    [index('routes/app/billing-return.tsx')],
  ),

  route(relative(ROUTE_PATHS.signIn), 'routes/account/sign-in.tsx'),
  route(relative(APP_PATHS.register), 'routes/account/register.tsx'),
  route(relative(ROUTE_PATHS.resetPassword), 'routes/account/reset-password.tsx'),
  route(relative(ROUTE_PATHS.verifyEmail), 'routes/account/verify-email.tsx'),
  route(relative(ROUTE_PATHS.acceptInvite), 'routes/account/accept-invite.tsx'),
  route(relative(ROUTE_PATHS.acceptEventInvite), 'routes/account/accept-event-invite.tsx'),

  // The language comes from the segment; the session check, from the layout under it.
  route(relative(APP_PATHS.app), 'routes/app/route.tsx', [
    layout('routes/app/layout.tsx', [
      index('routes/app/home.tsx'),
      route(underApp(APP_PATHS.welcome), 'routes/app/welcome.tsx'),
      route(underApp(APP_PATHS.organizations), 'routes/app/organizations.tsx'),
      route(underApp(APP_PATHS.newEvent), 'routes/app/new-event.tsx'),
      route(underApp(APP_PATHS.archivedEvents), 'routes/app/archived-events.tsx'),
      route(underApp(APP_PATHS.event), 'routes/app/event.tsx'),
      route(underApp(APP_PATHS.editEvent), 'routes/app/event-edit.tsx'),
      route(underApp(APP_PATHS.guests), 'routes/app/guests.tsx'),
      route(underApp(APP_PATHS.importGuests), 'routes/app/guests-import.tsx'),
      route(underApp(APP_PATHS.recordAnswer), 'routes/app/record-answer.tsx'),
      route(underApp(APP_PATHS.recordHousehold), 'routes/app/record-household.tsx'),
      route(underApp(APP_PATHS.sheets), 'routes/app/event-sheets.tsx'),
      route(underApp(APP_PATHS.answersSheet), 'routes/app/event-answers.tsx'),
      route(underApp(APP_PATHS.guestBook), 'routes/app/event-guest-book.tsx'),
      route(underApp(APP_PATHS.venues), 'routes/app/venues.tsx'),
      route(underApp(APP_PATHS.newVenue), 'routes/app/venue-new.tsx'),
      route(underApp(APP_PATHS.venueDirectory), 'routes/app/venue-directory.tsx'),
      route(underApp(APP_PATHS.editVenue), 'routes/app/venue-edit.tsx'),
      route(underApp(APP_PATHS.invitation), 'routes/app/invitation.tsx'),
      route(underApp(APP_PATHS.attendance), 'routes/app/event-attendance.tsx'),
      route(underApp(APP_PATHS.design), 'routes/app/design.tsx'),
      route(underApp(APP_PATHS.designLook), 'routes/app/design-look.tsx'),
      route(underApp(APP_PATHS.designSection), 'routes/app/design-section.tsx'),
      route(underApp(APP_PATHS.designQuestions), 'routes/app/design-questions.tsx'),
      route(underApp(APP_PATHS.newDesignQuestion), 'routes/app/design-question-new.tsx'),
      route(underApp(APP_PATHS.editDesignQuestion), 'routes/app/design-question-edit.tsx'),
      route(underApp(APP_PATHS.designMedia), 'routes/app/design-media.tsx'),
      route(underApp(APP_PATHS.photos), 'routes/app/photos.tsx'),
      route(underApp(APP_PATHS.agreements), 'routes/app/agreements.tsx'),
      route(underApp(APP_PATHS.seating), 'routes/app/seating.tsx'),
      route(underApp(APP_PATHS.exports), 'routes/app/exports.tsx'),
      route(underApp(APP_PATHS.ticketSales), 'routes/app/ticket-sales.tsx'),
      route(underApp(APP_PATHS.newTicketType), 'routes/app/ticket-type-new.tsx'),
      route(underApp(APP_PATHS.editTicketType), 'routes/app/ticket-type-edit.tsx'),
      route(underApp(APP_PATHS.announcement), 'routes/app/announcement.tsx'),
      route(underApp(APP_PATHS.orders), 'routes/app/orders.tsx'),
      route(underApp(APP_PATHS.door), 'routes/app/door.tsx'),
      route(underApp(APP_PATHS.followUps), 'routes/app/follow-ups.tsx'),
      route(underApp(APP_PATHS.team), 'routes/app/team.tsx'),
      route(underApp(APP_PATHS.runningOrder), 'routes/app/running-order.tsx'),
      route(underApp(APP_PATHS.suppressions), 'routes/app/suppressions.tsx'),
      route(underApp(APP_PATHS.billing), 'routes/app/billing.tsx'),
      route(underApp(APP_PATHS.promoCodes), 'routes/app/promo-codes.tsx'),
      route(underApp(APP_PATHS.vendors), 'routes/app/vendors.tsx'),
      route(underApp(APP_PATHS.eventVendors), 'routes/app/event-vendors.tsx'),
      route(underApp(APP_PATHS.newBooking), 'routes/app/event-vendor-new.tsx'),
      route(underApp(APP_PATHS.booking), 'routes/app/event-vendor.tsx'),
    ]),
    // Signed in, without the app's frame: the invitation's preview needs the whole window.
    layout('routes/app/preview-layout.tsx', [
      route(underApp(APP_PATHS.designPreview), 'routes/app/design-preview.tsx'),
      route(underApp(APP_PATHS.designDraftPreview), 'routes/app/design-draft-preview.tsx'),
      route(underApp(APP_PATHS.designAdoption), 'routes/app/design-adoption.tsx'),
    ]),
  ]),

  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
