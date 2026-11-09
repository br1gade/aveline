import { describe, expect, it } from 'vitest';

import type { VenueLayout } from './inventory-api';
import {
  canEditByHand,
  EMPTY_SECTION,
  layoutSchema,
  layoutValues,
  sectionBody,
  type LayoutSection,
} from './layout-form';

const numbered = (rows: LayoutSection['rows']): LayoutSection => ({
  ...EMPTY_SECTION,
  key: 'balcony',
  name: 'Balcony',
  rows,
});

function issues(values: unknown) {
  const result = layoutSchema.safeParse(values);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe('a venue layout typed by hand (PD-184)', () => {
  it('splits seat labels on commas, dropping blanks and spaces', () => {
    expect(sectionBody(numbered([{ label: 'A', seats: ' 1, 2,, 3 ,' }]))).toEqual({
      key: 'balcony',
      name: 'Balcony',
      mode: 'NUMBERED',
      rows: [{ label: 'A', seats: ['1', '2', '3'] }],
    });
  });

  it('sends a zone’s places as a number, and no rows', () => {
    expect(
      sectionBody({
        ...EMPTY_SECTION,
        key: 'floor',
        name: 'Floor',
        mode: 'UNNUMBERED',
        capacity: '120',
      }),
    ).toEqual({ key: 'floor', name: 'Floor', mode: 'UNNUMBERED', capacity: 120 });
  });

  it('puts each mistake on its own field', () => {
    expect(
      issues({
        key: 'Main Hall',
        name: '',
        sections: [
          numbered([{ label: '', seats: ' , ' }]),
          { ...EMPTY_SECTION, key: 'floor', name: 'Floor', mode: 'UNNUMBERED', capacity: '0' },
        ],
      }),
    ).toEqual([
      ['key', 'key'],
      ['name', 'name'],
      ['sections.0.rows.0.label', 'row'],
      ['sections.0.rows.0.seats', 'seats'],
      ['sections.1.capacity', 'capacity'],
    ]);
  });

  it.each(['1', '120', '999999'])('takes %s places in a zone', (capacity) => {
    const zone = { ...EMPTY_SECTION, key: 'floor', name: 'Floor', mode: 'UNNUMBERED', capacity };
    expect(issues({ key: 'main', name: 'Main', sections: [zone] })).toEqual([]);
  });

  it('reads a published layout back into the form, and out again unchanged', () => {
    const layout: VenueLayout = {
      id: 'lv1',
      key: 'main',
      name: 'Main',
      version: 2,
      sections: [
        {
          key: 'balcony',
          name: 'Balcony',
          mode: 'NUMBERED',
          rows: [{ label: 'A', seats: ['1', '2'] }],
        },
        { key: 'floor', name: 'Floor', mode: 'UNNUMBERED', capacity: 120 },
      ],
    };
    const values = layoutValues(layout);
    expect(values.sections.map(sectionBody)).toEqual(layout.sections);
  });
});

describe('when a layout is too large to type (PD-184)', () => {
  const sections = (count: number, seats: number): VenueLayout['sections'] =>
    Array.from({ length: count }, (_, index) => ({
      key: `s${index}`,
      name: `S${index}`,
      mode: 'NUMBERED' as const,
      rows: [{ label: 'A', seats: Array.from({ length: seats }, (_, seat) => String(seat)) }],
    }));
  const layout = (count: number, seats: number): VenueLayout => ({
    id: 'l',
    key: 'k',
    name: 'n',
    version: 1,
    sections: sections(count, seats),
  });

  it('is typed by hand up to 40 sections and 5,000 seats', () => {
    expect(canEditByHand(undefined)).toBe(true);
    expect(canEditByHand(layout(40, 1))).toBe(true);
    expect(canEditByHand(layout(1, 5000))).toBe(true);
  });

  it('is imported past either', () => {
    expect(canEditByHand(layout(41, 1))).toBe(false);
    expect(canEditByHand(layout(1, 5001))).toBe(false);
  });
});
