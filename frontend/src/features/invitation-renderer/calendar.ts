import type { Venue } from './schemas';

/** What a calendar entry is made of: never the guest's link, which is their credential. */
export interface CalendarEvent {
  /** The invitation's public name, which isn't a credential. */
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  venues: ReadonlyArray<Pick<Venue, 'name' | 'address'>>;
}

/** RFC 5545 §3.1: a line is at most 75 octets; a continuation starts with one space. */
const LINE_OCTETS = 75;

/** 2027-06-12T11:00:00.000Z → 20270612T110000Z: UTC, so no time zone table is needed. */
function utc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.3.11: a backslash, `;`, `,` and a line break are escaped. */
function text(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds at 75 octets of UTF-8, between letters, as Armenian and Cyrillic take two each. */
function fold(line: string, encoder: TextEncoder): string {
  const parts: string[] = [];
  let part = '';
  let octets = 0;
  for (const letter of line) {
    const size = encoder.encode(letter).length;
    const room = parts.length === 0 ? LINE_OCTETS : LINE_OCTETS - 1;
    if (octets + size > room) {
      parts.push(part);
      part = '';
      octets = 0;
    }
    part += letter;
    octets += size;
  }
  parts.push(part);
  return parts.map((piece, index) => (index === 0 ? piece : ` ${piece}`)).join('\r\n');
}

const place = ({ name, address }: Pick<Venue, 'name' | 'address'>) => `${name}, ${address}`;

/**
 * One event to save to a phone's calendar (design C-32, PD-178): the title, the times and the
 * venues. No link is written, as a calendar syncs to others, and the personal link is a credential.
 */
export function buildCalendarFile(event: CalendarEvent, now: Date): string {
  const [first] = event.venues;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aveline//Invitation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.slug}@aveline`,
    `DTSTAMP:${utc(now.toISOString())}`,
    `DTSTART:${utc(event.startsAt)}`,
    ...(event.endsAt ? [`DTEND:${utc(event.endsAt)}`] : []),
    `SUMMARY:${text(event.title)}`,
    ...(first ? [`LOCATION:${text(place(first))}`] : []),
    ...(first ? [`DESCRIPTION:${text(event.venues.map(place).join('\n'))}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const encoder = new TextEncoder();
  return `${lines.map((line) => fold(line, encoder)).join('\r\n')}\r\n`;
}
