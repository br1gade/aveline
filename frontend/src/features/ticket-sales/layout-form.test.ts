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

  const zone = (capacity: string, rows = EMPTY_SECTION.rows) => ({
    ...EMPTY_SECTION,
    key: 'floor',
    name: 'Floor',
    mode: 'UNNUMBERED',
    capacity,
    rows,
  });
  const layoutOf = (...sections: unknown[]) => ({ key: 'main', name: 'Main', sections });
  const seatsOf = (count: number) => Array.from({ length: count }, (_, seat) => seat).join(',');

  it.each(['1', '120', '100000'])('takes %s places in a zone', (capacity) => {
    expect(issues(layoutOf(zone(capacity)))).toEqual([]);
  });

  it.each(['0', '100001', '012', '1.5'])('refuses %s places in a zone', (capacity) => {
    expect(issues(layoutOf(zone(capacity)))).toEqual([['sections.0.capacity', 'capacity']]);
  });

  it('takes a row of 100 seats, each of 16 characters', () => {
    const seats = Array.from({ length: 100 }, (_, seat) => String(seat).padStart(16, '0'));
    expect(issues(layoutOf(numbered([{ label: 'A', seats: seats.join(',') }])))).toEqual([]);
  });

  it.each([
    ['101 seats', seatsOf(101)],
    ['a seat of 17 characters', 'x'.repeat(17)],
  ])('puts %s on the row’s seats', (_case, seats) => {
    expect(issues(layoutOf(numbered([{ label: 'A', seats }])))).toEqual([
      ['sections.0.rows.0.seats', 'seats'],
    ]);
  });

  it('names a row in up to 16 characters', () => {
    expect(issues(layoutOf(numbered([{ label: 'x'.repeat(16), seats: '1' }])))).toEqual([]);
    expect(issues(layoutOf(numbered([{ label: 'x'.repeat(17), seats: '1' }])))).toEqual([
      ['sections.0.rows.0.label', 'row'],
    ]);
  });

  it('ignores the rows a zone no longer shows', () => {
    const hidden = [{ label: 'x'.repeat(17), seats: 'y'.repeat(2000) }];
    expect(issues(layoutOf(zone('10', hidden)))).toEqual([]);
  });

  it.each([
    ['a key of 40', { key: 'a'.repeat(40) }, true],
    ['a key of 41', { key: 'a'.repeat(41) }, false],
    ['a key starting with a dash', { key: '-a' }, false],
    ['a name of 100', { name: 'n'.repeat(100) }, true],
    ['a name of 101', { name: 'n'.repeat(101) }, false],
  ])('judges %s', (_case, change, isTaken) => {
    expect(issues({ ...layoutOf(zone('1')), ...change }).length === 0).toBe(isTaken);
  });

  it.each([
    [0, false],
    [40, true],
    [41, false],
  ])('judges %i sections', (count, isTaken) => {
    const sections = Array.from({ length: count }, () => zone('1'));
    expect(issues(layoutOf(...sections)).length === 0).toBe(isTaken);
  });

  it.each([
    [100, true],
    [101, false],
  ])('judges %i rows in a section', (count, isTaken) => {
    const rows = Array.from({ length: count }, () => ({ label: 'A', seats: '1' }));
    expect(issues(layoutOf(numbered(rows))).length === 0).toBe(isTaken);
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

  it('counts seats across sections and rows, and not a zone’s places', () => {
    const row = { label: 'A', seats: Array.from({ length: 2501 }, (_, seat) => String(seat)) };
    expect(canEditByHand(layout(2, 2501))).toBe(false);
    expect(
      canEditByHand({
        ...layout(1, 1),
        sections: [{ key: 's', name: 'S', mode: 'NUMBERED', rows: [row, row] }],
      }),
    ).toBe(false);
    expect(
      canEditByHand({
        ...layout(1, 1),
        sections: [{ key: 'f', name: 'F', mode: 'UNNUMBERED', capacity: 100000 }],
      }),
    ).toBe(true);
  });
});
