import { zonedParts } from './time';

/**
 * A date and time as a host types them: in the event's own zone, from the browser's date and time
 * inputs, whose values have these forms in every language.
 */
export interface WallTime {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`, on a 24-hour clock. */
  time: string;
}

/**
 * The instant a typed time means in a zone. `skipped` is a time the clocks jump over on that day,
 * which is refused rather than moved, since a guest would be told a time nobody typed (design
 * PD-43). A time that happens twice, when the clocks go back, is the earlier of the two.
 */
export type ZonedInstant =
  { kind: 'instant'; iso: string } | { kind: 'skipped' } | { kind: 'invalid' };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;
const DAY = 86_400_000;

/**
 * The typed fields as epoch milliseconds read as if they were UTC, or null when they are no real
 * date and time. Years have four digits: the API takes the extended form only (docs/API.md §1).
 */
function wallMillis({ date, time }: WallTime): number | null {
  const day = DATE.exec(date);
  const clock = TIME.exec(time);
  if (!day || !clock) return null;
  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const [hour, minute] = [Number(clock[1]), Number(clock[2])];
  if (year < 1000 || hour > 23 || minute > 59) return null;
  const millis = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
  const check = new Date(millis);
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === dayOfMonth ? millis : null;
}

/** What a zone's clock reads at an instant, as epoch milliseconds read as if they were UTC. */
function clockMillis(instant: number, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which a zone's clock reads the typed time. The zone's offsets a day either side
 * give every candidate, since no zone changes its clocks twice in two days; a candidate counts if
 * the clock really reads the typed time then. None means the time was skipped; two, that it
 * happened twice. Only Intl with an explicit zone is used, never the device's own zone.
 */
export function instantFromWallTime(wall: WallTime, timeZone: string): ZonedInstant {
  const local = wallMillis(wall);
  if (local === null || !isTimeZone(timeZone)) return { kind: 'invalid' };
  const offsets = new Set(
    [local - DAY, local, local + DAY].map((probe) => clockMillis(probe, timeZone) - probe),
  );
  const [earliest] = [...offsets]
    .map((offset) => local - offset)
    .filter((candidate) => clockMillis(candidate, timeZone) === local)
    .sort((a, b) => a - b);
  return earliest === undefined
    ? { kind: 'skipped' }
    : { kind: 'instant', iso: new Date(earliest).toISOString() };
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** The date and time an instant reads as in a zone, in the inputs' forms. */
export function wallTimeOf(iso: string, timeZone: string): WallTime {
  const parts = zonedParts(iso, timeZone);
  return {
    date: `${String(parts.year).padStart(4, '0')}-${twoDigits(parts.month)}-${twoDigits(parts.day)}`,
    time: `${twoDigits(parts.hour)}:${twoDigits(parts.minute)}`,
  };
}

/**
 * The IANA zones this browser knows, plus `including` when it is missing. Browsers name some zones
 * differently (Chrome lists `Asia/Calcutta`, Firefox `Asia/Kolkata`) and the backend accepts any
 * name Intl knows, so an event's stored zone must stay choosable, or an edit would change it.
 */
export function timeZoneOptions(including?: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return including && !zones.includes(including) ? [...zones, including].sort() : zones;
}
