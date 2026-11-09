import { z } from 'zod';

import type { VenueLayout } from './inventory-api';

/** `PublishVenueTicketLayoutDto`'s limits: a key in lowercase, digits and dashes; names to 100. */
const key = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'key');
const name = z.string().trim().min(1, 'name').max(100, 'name');
const row = z.object({
  label: z.string().trim().max(16, 'row'),
  seats: z.string().max(1700, 'seats'),
});
const CAPACITY = /^[1-9][0-9]{0,5}$/;

function seatLabels(seats: string): string[] {
  return seats
    .split(',')
    .map((seat) => seat.trim())
    .filter(Boolean);
}

/**
 * A section as typed: numbered ones are rows of seat labels, each row named and with a seat; a zone is
 * a whole number of places. Each mistake is put on its own field, so the host sees which.
 */
const section = z
  .object({
    key,
    name,
    mode: z.enum(['NUMBERED', 'UNNUMBERED']),
    capacity: z.string(),
    rows: z.array(row).max(100),
  })
  .superRefine((value, context) => {
    if (value.mode === 'UNNUMBERED') {
      if (!CAPACITY.test(value.capacity.trim())) {
        context.addIssue({ code: 'custom', path: ['capacity'], message: 'capacity' });
      }
      return;
    }
    value.rows.forEach((entry, index) => {
      if (!entry.label.trim()) {
        context.addIssue({ code: 'custom', path: ['rows', index, 'label'], message: 'row' });
      }
      if (seatLabels(entry.seats).length === 0) {
        context.addIssue({ code: 'custom', path: ['rows', index, 'seats'], message: 'seats' });
      }
    });
  });

export const layoutSchema = z.object({ key, name, sections: z.array(section).min(1).max(40) });
/** A layout's key and name alone, as a CSV import names them. */
export const layoutIdentitySchema = z.object({ key, name });
export type LayoutValues = z.infer<typeof layoutSchema>;
export type LayoutSection = LayoutValues['sections'][number];

export const EMPTY_ROW = { label: '', seats: '' };
export const EMPTY_SECTION: LayoutSection = {
  key: '',
  name: '',
  mode: 'NUMBERED',
  capacity: '',
  rows: [EMPTY_ROW],
};

/** A published layout as the form's values, or an empty one to start from. */
export function layoutValues(existing?: VenueLayout): LayoutValues {
  if (!existing) return { key: '', name: '', sections: [EMPTY_SECTION] };
  return {
    key: existing.key,
    name: existing.name,
    sections: existing.sections.map((entry) =>
      entry.mode === 'NUMBERED'
        ? {
            key: entry.key,
            name: entry.name,
            mode: entry.mode,
            capacity: '',
            rows: entry.rows.map(({ label, seats }) => ({ label, seats: seats.join(', ') })),
          }
        : {
            key: entry.key,
            name: entry.name,
            mode: entry.mode,
            capacity: String(entry.capacity),
            rows: [EMPTY_ROW],
          },
    ),
  };
}

/** One section as the API takes it: seat labels split on commas, a zone's capacity as a number. */
export function sectionBody({ key, name, mode, capacity, rows }: LayoutSection) {
  if (mode === 'UNNUMBERED') return { key, name, mode, capacity: Number(capacity) };
  return {
    key,
    name,
    mode,
    rows: rows.map(({ label, seats }) => ({ label, seats: seatLabels(seats) })),
  };
}

/** Large layouts are imported as a file rather than typed (`venue-layout-import.tsx`). */
export function canEditByHand(layout: VenueLayout | undefined): boolean {
  const sections = layout?.sections ?? [];
  const seats = sections.reduce(
    (total, entry) =>
      entry.mode === 'NUMBERED'
        ? total + entry.rows.reduce((count, line) => count + line.seats.length, 0)
        : total,
    0,
  );
  return sections.length <= 40 && seats <= 5000;
}
