import { toMinor } from '@/lib/money';
import { instantFromWallTime } from '@/lib/time';

import {
  announcementFormValues,
  COPY_FIELDS,
  type AnnouncementFormValues,
  type TicketTypeFormValues,
  type TypeContext,
} from './form-model';
import type { CreateTicketTypeBody, Listing, ListingBody, UpdateTicketTypeBody } from './types';

/**
 * What the ticket type and announcement forms send (docs/API.md §5). A correction sends only what
 * changed; a name or words changed in one language are sent in every language, since the stored
 * map is replaced whole. The values are checked first (schemas.ts).
 */
function filled(map: Readonly<Record<string, string>>, languages: readonly string[]) {
  return Object.fromEntries(
    languages.flatMap((language) => {
      const text = (map[language] ?? '').trim();
      return text ? [[language, text]] : [];
    }),
  );
}

function isSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function instantOf(date: string, time: string, timeZone: string): string | undefined {
  if (!date || !time) return undefined;
  const instant = instantFromWallTime({ date, time }, timeZone);
  return instant.kind === 'instant' ? instant.iso : undefined;
}

function typeFields(values: TicketTypeFormValues, context: TypeContext): CreateTicketTypeBody {
  const salesStartAt = instantOf(values.salesStartDate, values.salesStartTime, context.timeZone);
  const salesEndAt = instantOf(values.salesEndDate, values.salesEndTime, context.timeZone);
  return {
    name: filled(values.names, context.languages),
    description: filled(values.descriptions, context.languages),
    priceMinor: toMinor(values.price, context.currency),
    quantityTotal: Number(values.quantityTotal),
    minPerOrder: Number(values.minPerOrder),
    maxPerOrder: Number(values.maxPerOrder),
    ...(salesStartAt ? { salesStartAt } : {}),
    ...(salesEndAt ? { salesEndAt } : {}),
  };
}

export function createTicketTypeBody(
  values: TicketTypeFormValues,
  context: TypeContext,
): CreateTicketTypeBody {
  const { description, ...fields } = typeFields(values, context);
  return {
    ...fields,
    ...(description && Object.keys(description).length > 0 ? { description } : {}),
  };
}

export function updateTicketTypeBody(
  baseline: TicketTypeFormValues,
  values: TicketTypeFormValues,
  context: TypeContext,
): UpdateTicketTypeBody {
  const before = typeFields(baseline, context);
  const after = typeFields(values, context);
  const keys = Object.keys({ ...before, ...after }) as Array<keyof CreateTicketTypeBody>;
  return Object.fromEntries(
    keys.flatMap((key) => (isSame(before[key], after[key]) ? [] : [[key, after[key]]])),
  );
}

function categoriesOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

/** Each field of the announcement as the API stores it, from the form or from the stored row. */
function listingFields(values: AnnouncementFormValues, languages: readonly string[]) {
  const copy = Object.fromEntries(
    COPY_FIELDS.map((field) => [
      field,
      filled(
        Object.fromEntries(
          languages.map((language) => [language, values.copy[language]?.[field] ?? '']),
        ),
        languages,
      ),
    ]),
  );
  return {
    ...copy,
    categories: categoriesOf(values.categories),
    slug: values.slug.trim(),
    isIndexable: values.isIndexable,
    buyerTicketLimit: values.buyerTicketLimit?.trim() ? Number(values.buyerTicketLimit) : null,
    heroAssetId: values.heroAssetId || null,
    ogImageId: values.ogImageId || null,
  };
}

/**
 * `PUT …/listing`: what changed against the stored listing, or against an empty one when there is
 * none yet. An empty address is never sent: the backend makes one from the headline.
 */
export function announcementBody(
  stored: Listing | null,
  values: AnnouncementFormValues,
  languages: readonly string[],
): ListingBody {
  const before: Record<string, unknown> = listingFields(
    announcementFormValues(stored, languages),
    languages,
  );
  const after: Record<string, unknown> = listingFields(values, languages);
  return Object.fromEntries(
    Object.entries(after).flatMap(([key, value]) => {
      if (key === 'slug' && value === '') return [];
      return isSame(before[key] ?? null, value) ? [] : [[key, value]];
    }),
  );
}
