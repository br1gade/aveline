import { describe, expect, it } from 'vitest';

import { readNotice, readVenues } from './read';
import type { VenueWire } from './types';

describe('venues as they arrive', () => {
  it('keeps the API’s order and only the fields the screens use', () => {
    const wire = [
      { id: 'v2', role: 'RECEPTION', name: 'Hall', address: 'A', mapUrl: null, arriveAt: null },
      {
        id: 'v1',
        role: 'CEREMONY',
        name: 'Church',
        address: 'B',
        mapUrl: 'https://maps.example.com/x',
        arriveAt: '2027-06-12T11:00:00.000Z',
        latitude: 40.16,
        longitude: 44.29,
        translations: { en: { name: 'Church' } },
        profileId: 'p1',
      },
    ] as VenueWire[];
    const venues = readVenues(wire);
    expect(venues.map((venue) => venue.id)).toEqual(['v2', 'v1']);
    expect(Object.keys(venues[1] ?? {}).sort()).toEqual(
      ['address', 'arriveAt', 'id', 'mapUrl', 'name', 'role'].sort(),
    );
  });

  it('reads a role it does not know as “other”', () => {
    const [venue] = readVenues([
      { id: 'v1', role: 'GARDEN', name: 'x', address: 'y', mapUrl: null, arriveAt: null },
    ]);
    expect(venue?.role).toBe('OTHER');
  });

  it('reads the notice a write returns, and nothing else of it', () => {
    const saved = {
      id: 'v1',
      name: 'Hall',
      notice: { isSuggested: true, changed: ['venues'], householdsInvited: 12 },
    };
    const notice = readNotice(saved);
    expect(notice).toEqual({ isSuggested: true, changed: ['venues'], householdsInvited: 12 });
  });
});
