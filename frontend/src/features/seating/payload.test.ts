import { describe, expect, it } from 'vitest';

import { bulkTablesPayload, newTablePayload, tableUpdatePayload } from './payload';

const initial = { name: 'Table 1', capacity: 10, zone: 'Terrace' };

describe('what a table’s save sends', () => {
  it('sends only what changed, and nothing when nothing did', () => {
    expect(tableUpdatePayload(initial, initial)).toEqual({});
    expect(tableUpdatePayload(initial, { ...initial, capacity: 12 })).toEqual({ capacity: 12 });
    expect(tableUpdatePayload(initial, { ...initial, name: 'Head table' })).toEqual({
      name: 'Head table',
    });
  });

  it('clears an emptied zone with null, and sets a new one', () => {
    expect(tableUpdatePayload(initial, { ...initial, zone: '' })).toEqual({ zone: null });
    expect(tableUpdatePayload({ ...initial, zone: '' }, { ...initial, zone: 'Garden' })).toEqual({
      zone: 'Garden',
    });
  });

  it('adds a table to the plan’s venue, leaving out an empty zone and a plan with none', () => {
    expect(newTablePayload({ name: 'Table 1', capacity: 8, zone: '' }, 'hall')).toEqual({
      name: 'Table 1',
      capacity: 8,
      venueId: 'hall',
    });
    expect(newTablePayload({ name: 'Table 1', capacity: 8, zone: 'Garden' }, null)).toEqual({
      name: 'Table 1',
      capacity: 8,
      zone: 'Garden',
    });
  });

  it('adds several the same way', () => {
    expect(
      bulkTablesPayload({ namePrefix: 'Table', count: 20, capacity: 10, zone: '' }, 'hall'),
    ).toEqual({
      namePrefix: 'Table',
      count: 20,
      capacity: 10,
      venueId: 'hall',
    });
  });
});

describe('what a correction sends about the venue', () => {
  const initial = { name: 'T', capacity: 4, zone: '', venueId: 'hall' };

  it('sends nothing of it when it did not change', () => {
    expect(tableUpdatePayload(initial, { ...initial })).toEqual({});
  });

  it('sends the new venue, and takes it off the old room’s plan', () => {
    expect(tableUpdatePayload(initial, { ...initial, venueId: 'church' })).toEqual({
      venueId: 'church',
      posX: null,
      posY: null,
    });
  });

  it('clears the venue with null', () => {
    expect(tableUpdatePayload(initial, { ...initial, venueId: '' })).toEqual({
      venueId: null,
      posX: null,
      posY: null,
    });
  });
});
