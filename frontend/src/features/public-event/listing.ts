import type { TFunction } from 'i18next';

import { formatMinor } from '@/lib/money';
import { APP_PATHS } from '@/route-paths';

import type { ListingCard } from './types';

/** The API's own default; a fixed page keeps the address free of a limit it would have to check. */
export const LISTING_PAGE_SIZE = 20;

/** `BrowsePublicEventsQuery`: longer is a 400. */
const MAX_CATEGORY_LENGTH = 64;

/** Past a 32-bit integer, or with a control character in the text, the database would refuse it. */
const MAX_OFFSET = 2_147_483_647;
const CONTROL_CHARACTER = /\p{Cc}/u;

export interface ListingQuery {
  offset: number;
  category?: string | undefined;
}

function offsetOf(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const offset = Number(value);
  return offset <= MAX_OFFSET ? offset : 0;
}

function categoryOf(value: string | null): string | undefined {
  const category = value?.trim();
  const isUsable =
    category && category.length <= MAX_CATEGORY_LENGTH && !CONTROL_CHARACTER.test(category);
  return isUsable ? category : undefined;
}

/** Whatever the address holds: a bad offset or category reads as none, never as a refusal. */
export function readListingQuery(params: URLSearchParams): ListingQuery {
  return {
    offset: offsetOf(params.get('offset')),
    category: categoryOf(params.get('category')),
  };
}

/** The listing's address. The language only when a switcher chooses it (design PD-40). */
export function listingHref({ offset, category, language }: ListingQuery & { language?: string }) {
  const params = new URLSearchParams();
  if (language) params.set('lang', language);
  if (category) params.set('category', category);
  if (offset > 0) params.set('offset', String(offset));
  const search = params.toString();
  return search ? `${APP_PATHS.publicEvents}?${search}` : APP_PATHS.publicEvents;
}

/**
 * The cheapest active ticket type, in words. "0" says free tickets exist, not that all are: the answer gives
 * only the lowest price (design PD-103).
 */
export function priceFrom(
  { fromPriceMinor, currency }: Pick<ListingCard, 'fromPriceMinor' | 'currency'>,
  language: string,
  t: TFunction<'public-event'>,
): string | null {
  if (fromPriceMinor === null || currency === null) return null;
  if (fromPriceMinor === '0') return t('listing.free');
  return t('listing.from', { price: formatMinor(fromPriceMinor, currency, language) });
}
