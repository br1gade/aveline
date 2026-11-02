/**
 * Setting up ticket sales (docs/API.md §5, "Setting up ticket sales"), interim until FR-1. The
 * host reads every language: names and words come as maps of language to text.
 */
export type Translations = Readonly<Record<string, string>>;

export interface TicketType {
  id: string;
  name: Translations;
  description: Translations;
  /** Minor units as a string; `"0"` is free (docs/API.md §1). */
  priceMinor: string;
  currency: string;
  quantityTotal: number;
  sold: number;
  /** In someone's checkout right now. */
  held: number;
  available: number;
  minPerOrder: number;
  maxPerOrder: number;
  salesStartAt: string | null;
  salesEndAt: string | null;
  /** `false` stops selling it without deleting anything. */
  isActive: boolean;
}

/** The public page that sells the tickets; the API's "listing". */
export interface Listing {
  slug: string;
  headline: Translations;
  summary: Translations;
  body: Translations;
  ogTitle: Translations;
  ogDescription: Translations;
  categories: string[];
  isIndexable: boolean;
  heroAssetId: string | null;
  ogImageId: string | null;
  /** `null` while it is not public. */
  publishedAt: string | null;
}

/** `POST …/ticket-types`. */
export interface CreateTicketTypeBody {
  name: Record<string, string>;
  description?: Record<string, string>;
  priceMinor: string;
  quantityTotal: number;
  minPerOrder: number;
  maxPerOrder: number;
  salesStartAt?: string;
  salesEndAt?: string;
}

/** `PATCH …/ticket-types/:typeId`: omitted means unchanged; a window cannot be cleared (FR-67). */
export type UpdateTicketTypeBody = Partial<CreateTicketTypeBody> & { isActive?: boolean };

/** `PUT …/listing`: omitted fields are left alone; `null` clears a picture. */
export interface ListingBody {
  headline?: Record<string, string>;
  summary?: Record<string, string>;
  body?: Record<string, string>;
  ogTitle?: Record<string, string>;
  ogDescription?: Record<string, string>;
  categories?: string[];
  slug?: string;
  isIndexable?: boolean;
  heroAssetId?: string | null;
  ogImageId?: string | null;
}
