import { z } from 'zod';

import { safeExternalUrl } from '@/lib/links';
import { instantFromWallTime } from '@/lib/time';

import { VENUE_ROLES } from './types';

/**
 * The venue form's checks, with the backend's own limits (`CreateVenueDto`), so a refusal is rare.
 * The server stays the authority. Messages are codes, worded by `useVenueFieldText`; `refused`
 * comes only from the server (`server-errors.ts`).
 */
export type VenueFieldCode =
  | 'required'
  | 'choose'
  | 'tooLong'
  | 'mapUrl'
  | 'arrivalPair'
  | 'dateInvalid'
  | 'timeSkipped'
  | 'refused';

const code = (value: VenueFieldCode) => ({ error: value });

/**
 * A required text the backend bounds. Blank is refused here, though the backend stores it (FR-36):
 * a blank address would also leave the event without the venue publishing needs.
 */
const text = (limit: number) =>
  z
    .string()
    .trim()
    .min(1, code('required'))
    .pipe(z.string().max(limit, code('tooLong')));

/** Only a link the guest page would show: http or https (`safeExternalUrl`; FR-36). */
const mapUrl = z
  .string()
  .trim()
  .max(500, code('tooLong'))
  .refine((value) => value === '' || safeExternalUrl(value) !== undefined, code('mapUrl'));

interface ArrivalFields {
  arrivalDate: string;
  arrivalTime: string;
}

/** Both or neither; when both, a time that exists in the event's zone that day (design PD-43). */
function checkArrival(timeZone: string) {
  return ({ arrivalDate: date, arrivalTime: time }: ArrivalFields, ctx: z.RefinementCtx) => {
    if (!date && !time) return;
    if (!date || !time) {
      const path = date ? 'arrivalTime' : 'arrivalDate';
      ctx.addIssue({ code: 'custom', path: [path], message: 'arrivalPair' });
      return;
    }
    const arrival = instantFromWallTime({ date, time }, timeZone);
    if (arrival.kind === 'invalid')
      ctx.addIssue({ code: 'custom', path: ['arrivalDate'], message: 'dateInvalid' });
    if (arrival.kind === 'skipped')
      ctx.addIssue({ code: 'custom', path: ['arrivalTime'], message: 'timeSkipped' });
  };
}

/**
 * The arrival's check runs even when another field failed, so every problem shows at once; the
 * default would skip it (zod 4).
 */
function whenArrivalPassed(payload: {
  issues: ReadonlyArray<{ path?: PropertyKey[] | undefined }>;
}) {
  return !payload.issues.some((issue) => ARRIVAL_FIELDS.includes(String(issue.path?.[0])));
}

const ARRIVAL_FIELDS: readonly string[] = ['arrivalDate', 'arrivalTime'];

/** The arrival is typed in the event's zone, so the schema is made for it. */
export function venueFormSchema(timeZone: string) {
  return z
    .object({
      // No default: the host chooses ("Choose…" is the empty option).
      role: z.union([z.literal(''), z.enum(VENUE_ROLES)]).pipe(z.enum(VENUE_ROLES, code('choose'))),
      name: text(160),
      address: text(300),
      mapUrl,
      arrivalDate: z.string(),
      arrivalTime: z.string(),
    })
    .superRefine(checkArrival(timeZone), { when: whenArrivalPassed });
}

type VenueFormSchema = ReturnType<typeof venueFormSchema>;
/** What the form holds while it is filled in: the role may still be unchosen. */
export type VenueFormInput = z.input<VenueFormSchema>;
/** What a valid form gives: trimmed, typed, ready for a payload. */
export type VenueFormValues = z.output<VenueFormSchema>;
