import { FeedbackCode, feedbackText } from './feedback-copy';

// Persisted jobs predate display codes. Match only the planner's controlled
// templates, preserving their original text and numeric details for old clients.
const REASONS: [RegExp, FeedbackCode][] = [
  [/^Needs \d+ seat\(s\); the venue has \d+ free$/, 'SEATING_VENUE_CAPACITY'],
  [/^Needs \d+ seat\(s\) at the table their household already sits at, which has \d+ free$/, 'SEATING_FAMILY_TABLE_FULL'],
  [/^No tables have been created for this seating arrangement$/, 'SEATING_NO_TABLES'],
  [/^Every table is full$/, 'SEATING_TABLES_FULL'],
  [/^Needs \d+ adjacent seats; the largest remaining table has \d+$/, 'SEATING_NO_TABLE_FITS'],
];

export function localizeSeatingResult(value: unknown, locale: string): unknown {
  if (!value || typeof value !== 'object' || !('unseated' in value) || !Array.isArray(value.unseated)) return value;
  return { ...value, unseated: value.unseated.map((item: unknown) => explainUnseated(item, locale)) };
}

function explainUnseated(value: unknown, locale: string) {
  if (!value || typeof value !== 'object' || !('reason' in value) || typeof value.reason !== 'string') return value;
  const reason = value.reason;
  const code = REASONS.find(([pattern]) => pattern.test(reason))?.[1] ?? 'SEATING_UNAVAILABLE';
  return { ...value, explanation: { code, locale, userMessage: feedbackText(code, locale), action: 'EDIT' } };
}
