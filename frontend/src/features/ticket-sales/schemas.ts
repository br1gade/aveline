import { z } from 'zod';

import { toMinor } from '@/lib/money';
import { instantFromWallTime } from '@/lib/time';

import type { TicketTypeFormValues } from './form-model';

/**
 * The ticket type and announcement forms' own checks, with the backend's limits
 * (`ticket-setup.dto.ts`, `ticket-type-rules.ts`), so most refusals never reach it. The server
 * stays the authority. Messages are codes, worded by the forms.
 */
export type SalesFieldCode =
  | 'required'
  | 'nameRequired'
  | 'price'
  | 'quantityRange'
  | 'belowTaken'
  | 'perOrderRange'
  | 'minAboveMax'
  | 'dateAndTime'
  | 'skipped'
  | 'invalid'
  | 'endBeforeStart'
  | 'cannotClear'
  | 'slug'
  | 'tooManyCategories'
  | 'categoryTooLong';

interface TypeRules {
  currency: string;
  timeZone: string;
  /** Sold and held already: capacity may not go below it. */
  taken: number;
  /** A window once set cannot be cleared through the API (FR-67). */
  startWasSet: boolean;
  endWasSet: boolean;
}

type Issue = [keyof TicketTypeFormValues, SalesFieldCode];

function wholeIn(text: string, low: number, high: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= low && value <= high ? value : null;
}

function priceIssue(price: string, currency: string): SalesFieldCode | null {
  if (price.trim() === '') return 'required';
  try {
    return toMinor(price, currency).length > 15 ? 'price' : null;
  } catch {
    return 'price';
  }
}

function quantityIssues(values: TicketTypeFormValues, rules: TypeRules): Issue[] {
  const total = wholeIn(values.quantityTotal, 1, 100_000);
  const min = wholeIn(values.minPerOrder, 1, 100);
  const max = wholeIn(values.maxPerOrder, 1, 100);
  return [
    ...(total === null ? [['quantityTotal', 'quantityRange'] as Issue] : []),
    ...(total !== null && total < rules.taken ? [['quantityTotal', 'belowTaken'] as Issue] : []),
    ...(min === null ? [['minPerOrder', 'perOrderRange'] as Issue] : []),
    ...(max === null ? [['maxPerOrder', 'perOrderRange'] as Issue] : []),
    ...(min !== null && max !== null && max < min ? [['maxPerOrder', 'minAboveMax'] as Issue] : []),
  ];
}

type Edge = 'salesStart' | 'salesEnd';

/** One end of the sales window: both or neither, a time that exists in the zone. */
function edgeIssue(values: TicketTypeFormValues, edge: Edge, rules: TypeRules) {
  const date = values[`${edge}Date`];
  const time = values[`${edge}Time`];
  const wasSet = edge === 'salesStart' ? rules.startWasSet : rules.endWasSet;
  if (!date && !time) return wasSet ? ([`${edge}Date`, 'cannotClear'] as Issue) : null;
  if (!date || !time) return [date ? `${edge}Time` : `${edge}Date`, 'dateAndTime'] as Issue;
  const instant = instantFromWallTime({ date, time }, rules.timeZone);
  return instant.kind === 'instant' ? instant.iso : ([`${edge}Time`, instant.kind] as Issue);
}

function windowIssues(values: TicketTypeFormValues, rules: TypeRules): Issue[] {
  const start = edgeIssue(values, 'salesStart', rules);
  const end = edgeIssue(values, 'salesEnd', rules);
  const issues = [start, end].filter((edge): edge is Issue => Array.isArray(edge));
  const isBackwards = typeof start === 'string' && typeof end === 'string' && end <= start;
  return isBackwards ? [...issues, ['salesEndDate', 'endBeforeStart']] : issues;
}

const translations = z.record(z.string(), z.string());

export function ticketTypeSchema(rules: TypeRules) {
  return z
    .object({
      names: translations,
      descriptions: translations,
      price: z.string(),
      quantityTotal: z.string(),
      minPerOrder: z.string(),
      maxPerOrder: z.string(),
      salesStartDate: z.string(),
      salesStartTime: z.string(),
      salesEndDate: z.string(),
      salesEndTime: z.string(),
    })
    .superRefine((values, context) => {
      const add = ([path, message]: Issue | [string, SalesFieldCode]) =>
        context.addIssue({ code: 'custom', path: [path], message });
      if (!Object.values(values.names).some((name) => name.trim() !== ''))
        add(['names', 'nameRequired']);
      const price = priceIssue(values.price, rules.currency);
      if (price) add(['price', price]);
      quantityIssues(values, rules).forEach(add);
      windowIssues(values, rules).forEach(add);
    });
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function announcementSchema() {
  return z
    .object({
      copy: z.record(
        z.string(),
        z.object({
          headline: z.string(),
          summary: z.string(),
          body: z.string(),
          ogTitle: z.string(),
          ogDescription: z.string(),
        }),
      ),
      categories: z.string(),
      slug: z.string(),
      isIndexable: z.boolean(),
      buyerTicketLimit: z
        .string()
        .trim()
        .refine(
          (value) =>
            value === '' ||
            (/^[0-9]+$/.test(value) && Number(value) >= 1 && Number(value) <= 100000),
          'buyerTicketLimit',
        )
        .optional(),
      heroAssetId: z.string(),
      ogImageId: z.string(),
    })
    .superRefine((values, context) => {
      const add = (path: string, message: SalesFieldCode) =>
        context.addIssue({ code: 'custom', path: [path], message });
      const slug = values.slug.trim();
      if (slug !== '' && (slug.length > 80 || !SLUG.test(slug))) add('slug', 'slug');
      const categories = values.categories
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (new Set(categories).size > 10) add('categories', 'tooManyCategories');
      if (categories.some((category) => category.length > 40)) add('categories', 'categoryTooLong');
    });
}
