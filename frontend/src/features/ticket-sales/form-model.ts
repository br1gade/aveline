import { minorToDecimalString } from '@/lib/money';
import { wallTimeOf } from '@/lib/time';

import type { Listing, TicketType, Translations } from './types';

/** A ticket type's form, in the browser's own inputs: text, dates and times in the event's zone. */
export interface TicketTypeFormValues {
  names: Record<string, string>;
  descriptions: Record<string, string>;
  /** In the currency's major units, as typed: "15000" dram, "10.50" dollars. */
  price: string;
  quantityTotal: string;
  minPerOrder: string;
  maxPerOrder: string;
  salesStartDate: string;
  salesStartTime: string;
  salesEndDate: string;
  salesEndTime: string;
}

export interface TypeContext {
  /** The event's languages, its default first. */
  languages: readonly string[];
  timeZone: string;
  currency: string;
}

/**
 * The event's languages, then any other a stored text holds: the event may have stopped publishing
 * one since. It stays on the form, since a save replaces the stored map whole and would lose it.
 */
export function languagesWithStored(
  languages: readonly string[],
  ...texts: readonly Translations[]
): string[] {
  const stored = texts.flatMap((text) =>
    Object.entries(text).flatMap(([language, words]) => (words.trim() ? [language] : [])),
  );
  return [...new Set([...languages, ...stored])];
}

function perLanguage(text: Translations, languages: readonly string[]): Record<string, string> {
  return Object.fromEntries(languages.map((language) => [language, text[language] ?? '']));
}

function wall(iso: string | null, timeZone: string) {
  return iso ? wallTimeOf(iso, timeZone) : { date: '', time: '' };
}

/** A new type starts at the backend's own defaults: one to ten per order (`withDefaults`). */
const NEW_TYPE = { price: '', quantityTotal: '', minPerOrder: '1', maxPerOrder: '10' };

function storedNumbers(type: TicketType) {
  return {
    price: minorToDecimalString(type.priceMinor, type.currency),
    quantityTotal: String(type.quantityTotal),
    minPerOrder: String(type.minPerOrder),
    maxPerOrder: String(type.maxPerOrder),
  };
}

/** The form as it opens: a stored type in the event's zone, or the backend's own defaults. */
export function ticketTypeFormValues(
  type: TicketType | null,
  context: TypeContext,
): TicketTypeFormValues {
  const start = wall(type ? type.salesStartAt : null, context.timeZone);
  const end = wall(type ? type.salesEndAt : null, context.timeZone);
  return {
    names: perLanguage(type ? type.name : {}, context.languages),
    descriptions: perLanguage(type ? type.description : {}, context.languages),
    ...(type ? storedNumbers(type) : NEW_TYPE),
    salesStartDate: start.date,
    salesStartTime: start.time,
    salesEndDate: end.date,
    salesEndTime: end.time,
  };
}

/** The words of the announcement in one language. */
export interface AnnouncementCopy {
  headline: string;
  summary: string;
  body: string;
  ogTitle: string;
  ogDescription: string;
}

export const COPY_FIELDS = ['headline', 'summary', 'body', 'ogTitle', 'ogDescription'] as const;

export interface AnnouncementFormValues {
  copy: Record<string, AnnouncementCopy>;
  /** Comma-separated, as typed. */
  categories: string;
  /** Empty leaves it to the backend, which makes one from the headline. */
  slug: string;
  isIndexable: boolean;
  /** An upload's id, or '' for none. */
  heroAssetId: string;
  ogImageId: string;
}

export function announcementFormValues(
  stored: Listing | null,
  languages: readonly string[],
): AnnouncementFormValues {
  const copyIn = (language: string) =>
    Object.fromEntries(
      COPY_FIELDS.map((field) => [field, stored ? (stored[field][language] ?? '') : '']),
    ) as unknown as AnnouncementCopy;
  if (!stored) {
    const copy = Object.fromEntries(languages.map((language) => [language, copyIn(language)]));
    return { copy, categories: '', slug: '', isIndexable: false, heroAssetId: '', ogImageId: '' };
  }
  return {
    copy: Object.fromEntries(languages.map((language) => [language, copyIn(language)])),
    categories: stored.categories.join(', '),
    slug: stored.slug,
    isIndexable: stored.isIndexable,
    heroAssetId: stored.heroAssetId ?? '',
    ogImageId: stored.ogImageId ?? '',
  };
}
