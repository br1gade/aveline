/**
 * The hold's countdown (docs/API.md §5: `reservesUntil` is a real deadline). Whole minutes only,
 * updated once a minute, as the invitation's countdown is (design PD-35): a counter changing every
 * second would need a pause control (WCAG 2.2.2). A screen reader hears it at five minutes, at one
 * and at the end, once each, and not when the page opens, which says the time itself.
 */
const MINUTE = 60_000;

/** The server's clock less this device's, from a response's `Date` header; 0 when unreadable. */
export function clockOffset(dateHeader: string | null, receivedAtMs: number): number {
  const serverNow = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  return Number.isNaN(serverNow) ? 0 : serverNow - receivedAtMs;
}

/** Whole minutes left, rounded up so "1 minute" lasts until the hold ends; 0 once it has. */
export function holdMinutesLeft(reservesUntil: string, nowMs: number, offsetMs: number): number {
  const left = Date.parse(reservesUntil) - (nowMs + offsetMs);
  return Number.isNaN(left) || left <= 0 ? 0 : Math.ceil(left / MINUTE);
}

export type HoldAnnouncement = 'five' | 'one' | 'over';

/** What to announce as the minutes go from `before` to `now`; `null` on the first reading. */
export function holdAnnouncement(before: number | null, now: number): HoldAnnouncement | null {
  if (before === null || before === now) return null;
  if (now === 0) return 'over';
  if (before > 1 && now <= 1) return 'one';
  return before > 5 && now <= 5 ? 'five' : null;
}
