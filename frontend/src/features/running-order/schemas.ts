import { z } from 'zod';

import { instantFromWallTime } from '@/lib/time';

/** Messages are codes, worded by the dialog. The backend stays the authority. */
export type EntryFieldCode = 'labelRequired' | 'required' | 'dateInvalid' | 'timeSkipped';

const code = (value: EntryFieldCode) => ({ error: value });

/** A blank row on the invitation reads as a bug to guests: one language at least (docs/API.md §6). */
function checkLabels(values: { labels: Record<string, string> }, ctx: z.RefinementCtx): void {
  if (!Object.values(values.labels).some((text) => text.trim() !== '')) {
    ctx.addIssue({ code: 'custom', path: ['labels'], message: 'labelRequired' });
  }
}

/** The typed time must exist in the event's zone on that day (design PD-43). */
function checkTime(timeZone: string) {
  return (values: { date: string; time: string }, ctx: z.RefinementCtx): void => {
    const instant = instantFromWallTime(values, timeZone);
    if (instant.kind === 'invalid')
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'dateInvalid' });
    if (instant.kind === 'skipped')
      ctx.addIssue({ code: 'custom', path: ['time'], message: 'timeSkipped' });
  };
}

function whenPassed(fields: readonly string[]) {
  return (payload: { issues: ReadonlyArray<{ path?: PropertyKey[] | undefined }> }) =>
    !payload.issues.some((issue) => fields.includes(String(issue.path?.[0])));
}

/** The time is typed in the event's zone, so the schema is made for it. */
export function entryFormSchema(timeZone: string) {
  return z
    .object({
      labels: z.record(z.string(), z.string()),
      date: z.string().min(1, code('required')),
      time: z.string().min(1, code('required')),
      /** Empty: not at a venue. */
      venueId: z.string(),
      isInternal: z.boolean(),
    })
    .superRefine(checkLabels)
    .superRefine(checkTime(timeZone), { when: whenPassed(['date', 'time']) });
}

export type EntryFormValues = z.output<ReturnType<typeof entryFormSchema>>;
