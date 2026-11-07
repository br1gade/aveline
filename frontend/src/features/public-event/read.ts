import type {
  BlockMedia,
  MediaVariant,
  QuestionType,
  RsvpFieldConfig,
} from '@/features/invitation-renderer';

import type {
  AgreementBeforeDoor,
  CheckoutQuestion,
  CheckoutRules,
  EventMetadata,
  ListingCard,
  PublicEvent,
  PublicListing,
  PublicTicketType,
  PublicVenue,
  TicketSection,
} from './types';

/**
 * The public event, read by naming each field it keeps (frontend ARCHITECTURE §9): a field the
 * page does not show never reaches it. Free JSON (image variants, the built-in fields' choices) is
 * read defensively; anything malformed is left out, never guessed.
 */
type Wire = Record<string, unknown>;

function record(value: unknown): Wire {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Wire)
    : {};
}

function list(value: unknown): Wire[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function whole(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function readVariant(wire: Wire): MediaVariant[] {
  const { url, width, height } = wire;
  return typeof url === 'string' && typeof width === 'number' && typeof height === 'number'
    ? [{ url, width, height }]
    : [];
}

export function readImage(value: unknown): BlockMedia | null {
  const wire = record(value);
  if (typeof wire.id !== 'string' || typeof wire.url !== 'string') return null;
  return {
    id: wire.id,
    url: wire.url,
    kind: typeof wire.kind === 'string' ? wire.kind : 'PHOTO',
    altText: text(wire.altText),
    width: whole(wire.width) || null,
    height: whole(wire.height) || null,
    variants: list(wire.variants).flatMap(readVariant),
  };
}

function readTicketType(wire: Wire): PublicTicketType[] {
  if (typeof wire.id !== 'string' || typeof wire.priceMinor !== 'string') return [];
  return [
    {
      id: wire.id,
      name: text(wire.name),
      description: text(wire.description),
      priceMinor: wire.priceMinor,
      currency: typeof wire.currency === 'string' ? wire.currency : 'AMD',
      available: whole(wire.available),
      minPerOrder: whole(wire.minPerOrder, 1),
      maxPerOrder: whole(wire.maxPerOrder, 1),
      salesEndAt: text(wire.salesEndAt),
    },
  ];
}

function readVenue(wire: Wire): PublicVenue[] {
  if (typeof wire.id !== 'string') return [];
  return [{ id: wire.id, name: text(wire.name) ?? '', address: text(wire.address) }];
}

function readFieldConfig(value: unknown): RsvpFieldConfig {
  const wire = record(value);
  const options = Array.isArray(wire.options)
    ? list(wire.options).flatMap(({ key, label }) =>
        typeof key === 'string' ? [{ key, label: text(label) ?? key }] : [],
      )
    : null;
  return { isEnabled: wire.isEnabled !== false, options };
}

const QUESTION_TYPES: ReadonlySet<string> = new Set([
  'TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'BOOLEAN',
]);

function readQuestion(wire: Wire): CheckoutQuestion[] {
  if (typeof wire.id !== 'string' || !QUESTION_TYPES.has(String(wire.type))) return [];
  return [
    {
      id: wire.id,
      type: wire.type as QuestionType,
      required: wire.required === true,
      prompt: text(wire.prompt),
      options: texts(wire.options),
    },
  ];
}

function readAgreement(wire: Wire): AgreementBeforeDoor[] {
  return typeof wire.questionId === 'string'
    ? [{ questionId: wire.questionId, prompt: text(wire.prompt) }]
    : [];
}

function readCheckout(value: unknown): CheckoutRules {
  const wire = record(value);
  const fields = record(wire.rsvpFields);
  return {
    attendanceMode: wire.attendanceMode === 'PER_VENUE' ? 'PER_VENUE' : 'EVENT_WIDE',
    attendanceRevision: whole(wire.attendanceRevision, 1),
    venues: list(wire.venues).flatMap((venue) =>
      typeof venue.id === 'string' ? [{ id: venue.id, name: text(venue.name) ?? '' }] : [],
    ),
    dietary: readFieldConfig(fields.dietary),
    drink: readFieldConfig(fields.drinkPreference),
    questions: list(wire.questions).flatMap(readQuestion),
    agreementsBeforeDoor: list(wire.acknowledgementsRequiredBeforeCheckIn).flatMap(readAgreement),
  };
}

function readMetadata(value: unknown, slug: string): EventMetadata {
  const wire = record(value);
  return {
    title: text(wire.title),
    description: text(wire.description),
    image: readImage(wire.image),
    locale: typeof wire.locale === 'string' ? wire.locale : '',
    alternateLocales: texts(wire.alternateLocales),
    canonicalPath: text(wire.canonicalPath) ?? `/events/${slug}`,
    robots: text(wire.robots) ?? 'noindex,nofollow',
  };
}

function readInventory(value: unknown): Exclude<PublicEvent['ticketInventory'], undefined> {
  const { layoutVersionId, sections } = record(value);
  if (typeof layoutVersionId !== 'string') return null;
  return {
    layoutVersionId,
    sections: list(sections).flatMap(({ key, name, mode, ticketTypeIds }): TicketSection[] =>
      typeof key === 'string' &&
      typeof name === 'string' &&
      (mode === 'NUMBERED' || mode === 'UNNUMBERED')
        ? [{ key, name, mode, ticketTypeIds: texts(ticketTypeIds) }]
        : [],
    ),
  };
}

export function readPublicEvent(value: unknown): PublicEvent {
  const wire = record(value);
  const slug = typeof wire.slug === 'string' ? wire.slug : '';
  const ticketInventory = readInventory(wire.ticketInventory);
  const offered = new Set(ticketInventory?.sections.flatMap(({ ticketTypeIds }) => ticketTypeIds));
  return {
    slug,
    ticketInventory,
    locale: typeof wire.locale === 'string' ? wire.locale : '',
    availableLocales: texts(wire.availableLocales),
    headline: text(wire.headline),
    summary: text(wire.summary),
    body: text(wire.body),
    heroImage: readImage(wire.heroImage),
    startsAt: typeof wire.startsAt === 'string' ? wire.startsAt : '',
    endsAt: text(wire.endsAt),
    timezone: typeof wire.timezone === 'string' ? wire.timezone : 'UTC',
    venues: list(wire.venues).flatMap(readVenue),
    ticketTypes: list(wire.ticketTypes)
      .flatMap(readTicketType)
      .filter((type) => !ticketInventory || offered.has(type.id)),
    checkout: readCheckout(wire.checkout),
    metadata: readMetadata(wire.metadata, slug),
  };
}

function readCard(wire: Wire): ListingCard[] {
  if (typeof wire.slug !== 'string' || wire.slug === '') return [];
  return [
    {
      slug: wire.slug,
      headline: text(wire.headline),
      summary: text(wire.summary),
      categories: texts(wire.categories),
      heroImage: readImage(wire.heroImage),
      venue: text(wire.venue),
      fromPriceMinor: typeof wire.fromPriceMinor === 'string' ? wire.fromPriceMinor : null,
      currency: text(wire.currency),
    },
  ];
}

/** Browsing public events, in the API's order, soonest first. */
export function readListing(value: unknown): PublicListing {
  const wire = record(value);
  return {
    cards: list(wire.items).flatMap(readCard),
    limit: whole(wire.limit),
    hasMore: wire.hasMore === true,
  };
}
