import { z } from 'zod';

import { instantFromWallTime, type ZonedInstant } from '@/lib/time';

import { EVENT_TYPES } from './types';

/**
 * The event form's checks, with the backend's own limits (`CreateEventDto`, `UpdateEventDto`), so
 * a refusal is rare. The server stays the authority. Messages are codes, worded by
 * `useEventFieldText`; the last three come only from the server (`server-errors.ts`).
 */
export type EventFieldCode =
  | 'required'
  | 'choose'
  | 'tooLong'
  | 'titleShort'
  | 'dateInvalid'
  | 'timeSkipped'
  | 'languages'
  | 'defaultLanguage'
  | 'timezone'
  | 'endsBefore'
  | 'endPair'
  | 'refused';

const code = (value: EventFieldCode) => ({ error: value });

/**
 * A text the backend bounds; a required one refuses blank, since the backend stores what it gets.
 * The other limits follow in a pipe rather than after `abort: true`, which would also stop the
 * object-level checks below, `when` or not.
 */
const text = (minimum: 0 | 1, limit: number, rest = z.string()) =>
  z
    .string()
    .trim()
    .min(minimum, code('required'))
    .pipe(rest.max(limit, code('tooLong')));

/** An object-level check runs only when the fields it reads passed their own. */
function whenPassed(fields: readonly string[]) {
  return (payload: { issues: ReadonlyArray<{ path?: PropertyKey[] | undefined }> }) =>
    !payload.issues.some((issue) => fields.includes(String(issue.path?.[0])));
}

interface StartFields {
  date: string;
  time: string;
  timezone: string;
}

/** The typed time must exist in the event's zone on that day (design PD-43). */
function checkStart(values: StartFields, ctx: z.RefinementCtx): void {
  const start = instantFromWallTime(values, values.timezone);
  if (start.kind === 'invalid')
    ctx.addIssue({ code: 'custom', path: ['date'], message: 'dateInvalid' });
  if (start.kind === 'skipped')
    ctx.addIssue({ code: 'custom', path: ['time'], message: 'timeSkipped' });
}

interface EndFields extends StartFields {
  endDate: string;
  endTime: string;
}

/**
 * The end is optional: both or neither. When both, a time that exists in the event's zone that
 * day, after the start, as the backend requires (`endsAt: must be after startsAt`).
 */
function checkEnd(values: EndFields, ctx: z.RefinementCtx): void {
  const { endDate: date, endTime: time } = values;
  if (!date && !time) return;
  if (!date || !time) {
    ctx.addIssue({ code: 'custom', path: [date ? 'endTime' : 'endDate'], message: 'endPair' });
    return;
  }
  const issue = endIssue(instantFromWallTime({ date, time }, values.timezone), values);
  if (issue) ctx.addIssue({ code: 'custom', ...issue });
}

function endIssue(end: ZonedInstant, start: StartFields) {
  if (end.kind === 'invalid') return { path: ['endDate'], message: 'dateInvalid' };
  if (end.kind === 'skipped') return { path: ['endTime'], message: 'timeSkipped' };
  const begins = instantFromWallTime(start, start.timezone);
  if (begins.kind === 'instant' && end.iso <= begins.iso) {
    return { path: ['endDate'], message: 'endsBefore' };
  }
  return null;
}

/** A language's title and hosts, each bounded as the backend bounds them (`EVENT_TRANSLATABLE`). */
const translation = z.object({
  title: z.string().trim().max(200, code('tooLong')),
  hostsLabel: z.string().trim().max(200, code('tooLong')),
});

function checkDefaultLanguage(
  values: { locales: string[]; defaultLocale: string },
  ctx: z.RefinementCtx,
): void {
  if (!values.locales.includes(values.defaultLocale)) {
    ctx.addIssue({ code: 'custom', path: ['defaultLocale'], message: 'defaultLanguage' });
  }
}

/**
 * Creating and correcting share one form. The hosts differ: optional when creating, where the
 * title stands in, and required when correcting, where the backend refuses an empty one. The end,
 * the sides and the other languages are shown when correcting only (design PD-109, PD-110).
 */
export function eventFormSchema(mode: 'create' | 'edit') {
  return z
    .object({
      // No default: the host chooses ("Choose…" is the empty option).
      type: z.union([z.literal(''), z.enum(EVENT_TYPES)]).pipe(z.enum(EVENT_TYPES, code('choose'))),
      title: text(1, 200, z.string().min(2, code('titleShort'))),
      hostsLabel: text(mode === 'edit' ? 1 : 0, 200),
      date: z.string().min(1, code('required')),
      time: z.string().min(1, code('required')),
      timezone: z.string().min(1, code('choose')),
      locales: z.array(z.string()).min(1, code('languages')).max(10, code('languages')),
      defaultLocale: z.string(),
      endDate: z.string(),
      endTime: z.string(),
      sideALabel: text(0, 60),
      sideBLabel: text(0, 60),
      translations: z.record(z.string(), translation),
    })
    .superRefine(checkStart, { when: whenPassed(['date', 'time', 'timezone']) })
    .superRefine(checkEnd, {
      when: whenPassed(['date', 'time', 'timezone', 'endDate', 'endTime']),
    })
    .superRefine(checkDefaultLanguage, { when: whenPassed(['locales']) });
}

type EventFormSchema = ReturnType<typeof eventFormSchema>;
/** What the form holds while it is filled in: the type may still be unchosen. */
export type EventFormInput = z.input<EventFormSchema>;
/** What a valid form gives: trimmed, typed, ready for a payload. */
export type EventFormValues = z.output<EventFormSchema>;
