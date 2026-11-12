/**
 * Client paths the backend builds from PUBLIC_APP_URL, into emails and messages and as the bank's
 * default return pages (setup proposal §5.3). Renaming one breaks every link already sent: it
 * needs a backend change in the same release. docs/API.md §3 "Browser route contract" publishes
 * the same table (FR-8); route-paths.test.ts pins this one to that table and to the backend's
 * sources.
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
  /** backend/src/modules/public-events/public-events.service.ts: `metadata.canonicalPath` */
  publicEvent: '/events/:slug',
  /** The bank's default return pages: ticketing.service.ts and billing/subscriptions.service.ts */
  ticketPaymentReturn: '/tickets/return',
  billingPaymentReturn: '/billing/return',
  /** communications/invitation-email-footer.ts: every new invitation email links it (FR-136). */
  privacyRequest: '/privacy-request',
  /** Built by the client (docs/API.md §6). */
  brief: '/briefs/:briefToken',
} as const;

/** The client's own paths. Nothing outside the client links to them, so they are free to rename. */
export const APP_PATHS = {
  register: '/register',
  app: '/app',
  welcome: '/app/welcome',
  /** The organization's plan and invoices. */
  billing: '/app/billing',
  /** Choosing an organization, for an account with several. */
  organizations: '/app/organizations',
  /** Aveline's own staff: not linked for customers. */
  staff: '/app/staff',
  staffCustomers: '/app/staff/customers',
  staffNewEvent: '/app/staff/customers/:organizationId/new-event',
  staffDataRequests: '/app/staff/data-requests',
  staffAccessReviews: '/app/staff/access-reviews',
  /** The organization itself: its name, members and invitations. */
  organization: '/app/organization',
  /** Static, so it ranks above `event`'s `:eventId`. */
  newEvent: '/app/events/new',
  /** Events put away. Static, so it ranks above `event`'s `:eventId`. */
  archivedEvents: '/app/events/archived',
  event: '/app/events/:eventId',
  editEvent: '/app/events/:eventId/edit',
  guests: '/app/events/:eventId/guests',
  /** Static, so it would rank above a `:guestId` under `guests` too. */
  importGuests: '/app/events/:eventId/guests/import',
  /** An answer a guest gave by phone or in person, recorded by the host. */
  recordAnswer: '/app/events/:eventId/guests/:guestId/answer',
  /** The same for each member of a household, on one page. */
  recordHousehold: '/app/events/:eventId/households/:householdId/answer',
  /** Catering, bar, playlist and views: what guests' answers add up to. */
  sheets: '/app/events/:eventId/sheets',
  /** What guests answered to the host's own questions. */
  answersSheet: '/app/events/:eventId/sheets/answers',
  /** The messages guests left with their answers. */
  guestBook: '/app/events/:eventId/sheets/guest-book',
  venues: '/app/events/:eventId/venues',
  /** Static, so it would rank above a `:venueId` under `venues` too. */
  newVenue: '/app/events/:eventId/venues/new',
  /** The shared directory of halls, which Aveline staff keep and every role reads. */
  venueDirectory: '/app/events/:eventId/venues/directory',
  editVenue: '/app/events/:eventId/venues/:venueId/edit',
  /** Publishing, closing, reopening and sending the event's invitation. */
  invitation: '/app/events/:eventId/invitation',
  /** How guests answer: once for the event, or per venue. */
  attendance: '/app/events/:eventId/attendance',
  /** Designing the invitation: its sections, then each part on a page of its own. */
  design: '/app/events/:eventId/design',
  designLook: '/app/events/:eventId/design/look',
  designSection: '/app/events/:eventId/design/sections/:blockType',
  designQuestions: '/app/events/:eventId/design/questions',
  /** Static, so it ranks above `editDesignQuestion`'s `:questionId`. */
  newDesignQuestion: '/app/events/:eventId/design/questions/new',
  editDesignQuestion: '/app/events/:eventId/design/questions/:questionId',
  designMedia: '/app/events/:eventId/design/media',
  /** Outside the app's frame: the invitation needs the whole window. */
  designPreview: '/app/events/:eventId/design/preview',
  /** A section's unsaved edits, drawn in a frame on its page: the only page the app frames. */
  designDraftPreview: '/app/events/:eventId/design/draft-preview',
  /** An authored template's preview and confirmation. */
  designAdoption: '/app/events/:eventId/design/look/adopt/:versionId',
  /** Guests' photos to moderate; the API calls it the gallery. */
  photos: '/app/events/:eventId/photos',
  /** Who agreed to the hosts' statements, read-only. */
  agreements: '/app/events/:eventId/agreements',
  /** Tables and seats per venue, automatic seating, and showing guests their tables. */
  seating: '/app/events/:eventId/seating',
  /** Fixed copies of the event's lists, made in the background and downloaded while signed in. */
  exports: '/app/events/:eventId/exports',
  /** Selling tickets: who can find the event, its ticket types and its announcement. */
  ticketSales: '/app/events/:eventId/tickets',
  /** Static, so it ranks above `editTicketType`'s `:typeId`. */
  newTicketType: '/app/events/:eventId/tickets/types/new',
  editTicketType: '/app/events/:eventId/tickets/types/:typeId',
  /** The public page that sells the tickets; the API calls it the listing. */
  announcement: '/app/events/:eventId/tickets/announcement',
  /** Ticket orders by status, an order's people and tickets, cancelling and reconciling. */
  orders: '/app/events/:eventId/orders',
  /** Letting people in on the day: by name or by a ticket's code, with the counts. */
  door: '/app/events/:eventId/door',
  /** Chasing who has not answered, and thanking guests afterwards. */
  followUps: '/app/events/:eventId/follow-ups',
  /** Who works on this event: members, open invitations, roles. */
  team: '/app/events/:eventId/team',
  /** Who changed something on the event. */
  activity: '/app/events/:eventId/activity',
  /** The day's running order: what happens when, and where. */
  runningOrder: '/app/events/:eventId/running-order',
  /** The organization's own: who must not be contacted, across every event. */
  suppressions: '/app/suppressions',
  /** The organization's own: discounts on tickets, for every event or one. */
  promoCodes: '/app/promo-codes',
  /** The organization's own vendors, and Aveline's curated list beside them. */
  vendors: '/app/vendors',
  /** Who is engaged for this event, each with the brief they read. */
  eventVendors: '/app/events/:eventId/vendors',
  /** Static, so it ranks above `booking`'s `:bookingId`. */
  newBooking: '/app/events/:eventId/vendors/new',
  booking: '/app/events/:eventId/vendors/:bookingId',
  /** The price list, for anyone. */
  pricing: '/pricing',
  /** How to reach Aveline, for anyone (design C-54). */
  help: '/help',
  /** The privacy notice: a placeholder until it is rewritten and reviewed before launch (C-50). */
  privacy: '/privacy',
  /** Browsing public events. Static, so it needs no rank against `ROUTE_PATHS.publicEvent`. */
  publicEvents: '/events',
  /** Buying tickets for a public event: who comes on each ticket, a promo code, the order. */
  checkout: '/events/:slug/checkout',
  /**
   * The buyer's order once its link's token is out of the address (frontend CLAUDE.md §4). The
   * static path ranks above `ROUTE_PATHS.ticket`'s `:accessToken`.
   */
  ticketOrder: '/tickets',
  /**
   * A vendor's brief once its link's token is out of the address (design PD-124). The static path
   * ranks above `ROUTE_PATHS.brief`'s `:briefToken`.
   */
  briefPage: '/briefs',
} as const;
