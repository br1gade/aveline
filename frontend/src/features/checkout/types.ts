/**
 * Checkout's form values and what it sends and receives (docs/API.md §5, "Buying tickets"),
 * checked against the schema at each call (FR-1). What is sent is built in payload.ts; how the form
 * is checked, in schemas.ts.
 */
export type VenueStatus = 'ATTENDING' | 'DECLINED' | 'UNDECIDED';

/**
 * Text, a position, or positions, as form inputs hold them. '' is unanswered, and so are `null`,
 * `false` and `undefined`, which React Hook Form leaves in an input nobody touched.
 */
export type AnswerValue = string | string[] | boolean | null | undefined;

/** One person, on one ticket. Their contacts are their own, never filled from the buyer's. */
export interface PersonValues {
  ticketTypeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** "This ticket is for me": the buyer's own ticket, on one card at most (design PD-79). */
  isBuyer: boolean;
  /** The host's dietary choices, by key. */
  dietary: string[];
  dietaryNotes: string;
  drink: string;
  answers: Record<string, AnswerValue>;
  /** In PER_VENUE, this person's own answer at each venue; '' is not answered. */
  venues: Record<string, VenueStatus | '' | null | undefined>;
}

export interface CheckoutValues {
  buyerFirstName: string;
  buyerLastName: string;
  buyerEmail: string;
  buyerPhone: string;
  people: PersonValues[];
}

export interface CustomAnswerBody {
  questionId: string;
  value: string | number | number[] | boolean;
}

export interface AttendeeBody {
  ticketTypeId: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  venueAttendance?: Array<{ venueId: string; status: VenueStatus }>;
  dietary?: string[];
  dietaryNotes?: string;
  drinkPreference?: string;
  answers?: CustomAnswerBody[];
}

/** `POST /public/events/:slug/orders`, without its key, which the attempt adds. */
export interface TicketSelection {
  sectionKey: string;
  seatId?: string;
}

export interface OrderBody {
  layoutVersionId?: string;
  selections?: TicketSelection[];
  items: Array<{ ticketTypeId: string; quantity: number }>;
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string;
  locale: string;
  attendanceRevision: number;
  attendees: AttendeeBody[];
  provider: PaymentProvider;
  promoCode?: string;
}

export type PaymentProvider = 'AMERIABANK' | 'INECOBANK' | 'IDBANK' | 'FAKE';

/** The order as checkout's answer gives it: only what the next step needs. */
export interface PlacedOrder {
  accessToken: string;
  status: string;
  /** The bank's page, for an order with something to pay. */
  redirectUrl: string | null;
}

/** `POST /public/events/:slug/promo-check`: a preview, priced by the server. */
export interface PromoQuote {
  code: string;
  isApplicable: boolean;
  /** The backend's own sentence, in English, when the code does not apply. */
  reason: string | null;
  subtotalMinor: string;
  discountMinor: string;
  totalMinor: string;
  currency: string;
}
