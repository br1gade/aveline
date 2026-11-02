import type { Listing, TicketType, Translations } from './types';

/**
 * Ticket types and the listing, read by naming each field kept (frontend ARCHITECTURE §9). The
 * listing comes back as its stored row; only what the pages show is kept.
 */
type Wire = Record<string, unknown>;

function record(value: unknown): Wire {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Wire)
    : {};
}

/** A language-to-text map, keeping only text: anything else in the stored JSON is left out. */
export function readTranslations(value: unknown): Translations {
  return Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

function instant(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function readTicketType(value: unknown): TicketType {
  const wire = record(value);
  return {
    id: String(wire.id),
    name: readTranslations(wire.name),
    description: readTranslations(wire.description),
    priceMinor: typeof wire.priceMinor === 'string' ? wire.priceMinor : '0',
    currency: typeof wire.currency === 'string' ? wire.currency : 'AMD',
    quantityTotal: whole(wire.quantityTotal),
    sold: whole(wire.sold),
    held: whole(wire.held),
    available: whole(wire.available),
    minPerOrder: whole(wire.minPerOrder),
    maxPerOrder: whole(wire.maxPerOrder),
    salesStartAt: instant(wire.salesStartAt),
    salesEndAt: instant(wire.salesEndAt),
    isActive: wire.isActive !== false,
  };
}

export function readListing(value: unknown): Listing {
  const wire = record(value);
  return {
    slug: typeof wire.slug === 'string' ? wire.slug : '',
    headline: readTranslations(wire.headline),
    summary: readTranslations(wire.summary),
    body: readTranslations(wire.body),
    ogTitle: readTranslations(wire.ogTitle),
    ogDescription: readTranslations(wire.ogDescription),
    categories: Array.isArray(wire.categories)
      ? wire.categories.filter((entry) => typeof entry === 'string')
      : [],
    isIndexable: wire.isIndexable === true,
    heroAssetId: instant(wire.heroAssetId),
    ogImageId: instant(wire.ogImageId),
    publishedAt: instant(wire.publishedAt),
  };
}

/** A name or words in the page's language, then the event's default, then any; `null` for none. */
export function inLanguage(text: Translations, language: string, fallback: string): string | null {
  const any = Object.values(text).find((value) => value.trim() !== '');
  return text[language]?.trim() || text[fallback]?.trim() || any || null;
}
