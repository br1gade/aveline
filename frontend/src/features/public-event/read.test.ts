import { describe, expect, it } from 'vitest';

import { readPublicEvent } from './read';
import { perVenueCheckout, publicEventWire } from './test-data';

describe('reading a public event', () => {
  it('keeps the fields the pages use, and nothing else', () => {
    const stray = `tok-${crypto.randomUUID()}`;
    const event = readPublicEvent(publicEventWire({ guestToken: stray, accessToken: stray }));
    expect(JSON.stringify(event)).not.toContain(stray);
    expect(event.ticketTypes.map((type) => [type.id, type.priceMinor, type.available])).toEqual([
      ['general', '0', 120],
      ['table', '15000', 3],
    ]);
    expect(event.venues).toEqual([{ id: 'v-garden', name: 'The Garden', address: '1 Abovyan St' }]);
    expect(event.metadata.canonicalPath).toBe('/events/autumn-jazz-night');
  });

  it('reads the checkout rules of each attendance mode', () => {
    const wide = readPublicEvent(publicEventWire()).checkout;
    expect(wide.attendanceMode).toBe('EVENT_WIDE');
    expect(wide.dietary).toEqual({
      isEnabled: true,
      options: [{ key: 'vegetarian', label: 'Vegetarian' }],
    });
    expect(wide.drink).toEqual({ isEnabled: false, options: null });
    const perVenue = readPublicEvent(publicEventWire({ checkout: perVenueCheckout() })).checkout;
    expect(perVenue).toMatchObject({ attendanceMode: 'PER_VENUE', attendanceRevision: 3 });
    expect(perVenue.venues.map((venue) => venue.id)).toEqual(['v-church', 'v-hall']);
    expect(perVenue.agreementsBeforeDoor).toEqual([
      { questionId: 'q-rules', prompt: 'I accept the house rules' },
    ]);
  });

  it('leaves out what it cannot read rather than guessing', () => {
    const event = readPublicEvent(
      publicEventWire({
        ticketTypes: [
          { id: 'x', priceMinor: 15000 },
          { name: 'No id', priceMinor: '1' },
        ],
        heroImage: {
          id: 'm1',
          url: '/files/m1.jpg',
          variants: [{ url: '/a.webp' }, { url: '/b.webp', width: 480, height: 320 }],
        },
        checkout: {
          questions: [
            { id: 'q', type: 'SIGNATURE' },
            { id: 'q2', type: 'BOOLEAN' },
          ],
        },
      }),
    );
    expect(event.ticketTypes).toEqual([]);
    expect(event.heroImage?.variants).toEqual([{ url: '/b.webp', width: 480, height: 320 }]);
    expect(event.checkout.questions.map((question) => question.id)).toEqual(['q2']);
    expect(event.checkout.dietary).toEqual({ isEnabled: true, options: null });
  });
});
