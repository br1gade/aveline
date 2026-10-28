import { z } from 'zod';

import type { BlockMedia, InvitationBlock } from './types';

/**
 * Readers for the free JSON inside blocks. Block content is whatever the host's editor stored
 * (design R-30), so every field is optional and a malformed one is dropped rather than breaking
 * the page: a guest should never see an error because a host's note had the wrong shape.
 */

/** A non-blank string, trimmed; anything else is absent. */
const text = z.string().trim().min(1).optional().catch(undefined);

function readObject<T extends z.ZodRawShape>(shape: T, value: unknown) {
  const result = z.object(shape).safeParse(value);
  return result.success ? result.data : z.object(shape).parse({});
}

export function heroContent(block: InvitationBlock) {
  return readObject({ title: text, subtitle: text }, block.content);
}

export function titledContent(block: InvitationBlock) {
  return readObject({ title: text }, block.content);
}

export function bodyContent(block: InvitationBlock) {
  return readObject({ title: text, body: text }, block.content);
}

export function notesContent(block: InvitationBlock) {
  const item = z.object({ title: text, body: text });
  const content = readObject({ title: text, items: z.array(z.unknown()).catch([]) }, block.content);
  const items = content.items.flatMap((value) => {
    const parsed = item.safeParse(value);
    return parsed.success && (parsed.data.title ?? parsed.data.body) ? [parsed.data] : [];
  });
  return { title: content.title, items };
}

export function signatureContent(block: InvitationBlock) {
  return readObject({ closing: text }, block.content);
}

export function chatContent(block: InvitationBlock) {
  return readObject({ title: text, body: text, url: text, label: text }, block.content);
}

export function contactContent(block: InvitationBlock) {
  return readObject({ title: text, organizer: text, phone: text }, block.content);
}

/** Paragraphs of a plain-text body: blank lines separate them. */
export function paragraphs(body: string | undefined): string[] {
  return (body ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** Dress-code swatches: only valid six-digit hex values in `settings.palette` (PD-24). */
export function swatchColours(block: InvitationBlock): string[] {
  const settings = readObject({ palette: z.array(z.unknown()).catch([]) }, block.settings);
  return settings.palette.filter(
    (value): value is string => typeof value === 'string' && HEX_COLOUR.test(value),
  );
}

export function photos(block: InvitationBlock): BlockMedia[] {
  return block.media.filter((media) => media.kind === 'PHOTO' || media.kind === 'COVER');
}

const venue = z.object({
  /** What a timeline entry's `venueId` points at. */
  id: z.string().nullable().catch(null),
  role: z.string(),
  name: z.string(),
  address: z.string(),
  mapUrl: z.string().nullable().catch(null),
  arriveAt: z.string().nullable().catch(null),
});
export type Venue = z.infer<typeof venue>;

/** VENUE and MAP data: the event's venues, in the event's order. */
export function venues(block: InvitationBlock): Venue[] {
  return listOf(venue, block.data);
}

const timelineEntry = z.object({
  label: z.string().trim().min(1),
  occursAt: z.string(),
  venueId: z.string().nullable().catch(null),
});
export type TimelineEntry = z.infer<typeof timelineEntry>;

/** The name of each venue the page shows, by id: for naming a timeline entry's place. */
export function venueNames(blocks: readonly InvitationBlock[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const block of blocks) {
    if (block.type !== 'VENUE' && block.type !== 'MAP') continue;
    for (const place of venues(block)) {
      if (place.id) names.set(place.id, place.name);
    }
  }
  return names;
}

/** TIMELINE data, in the order given. An entry with no label in this language is left out. */
export function timelineEntries(block: InvitationBlock): TimelineEntry[] {
  return listOf(timelineEntry, block.data);
}

const countdown = z.object({ target: z.string(), timezone: z.string() });

export function countdownData(block: InvitationBlock): z.infer<typeof countdown> | null {
  const result = countdown.safeParse(block.data);
  return result.success ? result.data : null;
}

function listOf<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

/** A `tel:` link from a displayed number: digits and a leading plus only. */
export function telephoneHref(phone: string): string | undefined {
  const digits = phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits.replace('+', '').length >= 3 ? `tel:${digits}` : undefined;
}
