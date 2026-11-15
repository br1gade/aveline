import { afterEach, describe, expect, it } from 'vitest';

import { checkoutDraftStore, type CheckoutDraft } from './draft-store';

const DRAFT: CheckoutDraft = {
  scope: 'autumn-jazz-night::general.1',
  revision: 3,
  values: {
    buyerFirstName: 'Ani',
    buyerLastName: '',
    buyerEmail: 'ani@example.com',
    buyerPhone: '',
    people: [
      {
        ticketTypeId: 'general',
        firstName: 'Anna',
        lastName: '',
        email: '',
        phone: '',
        isBuyer: false,
        dietary: [],
        dietaryNotes: '',
        drink: '',
        answers: { 'q-meal': '0', 'q-none': null },
        venues: { v1: 'ATTENDING', v2: '' },
      },
    ],
  },
  picks: { 0: { sectionKey: 'balcony', seatId: 'seat-12' } },
};

afterEach(() => sessionStorage.clear());

describe('an order being typed, kept in this tab (design PD-152)', () => {
  it('reads back what was written, one per event', () => {
    checkoutDraftStore('autumn-jazz-night').write(DRAFT);
    expect(checkoutDraftStore('autumn-jazz-night').read()).toEqual(DRAFT);
    expect(checkoutDraftStore('another-event').read()).toBeNull();
  });

  it('reads a draft of another shape as none', () => {
    checkoutDraftStore('autumn-jazz-night').write(DRAFT);
    const [name] = Object.keys(sessionStorage);
    sessionStorage.setItem(name ?? '', JSON.stringify({ ...DRAFT, values: { people: 'Anna' } }));
    expect(checkoutDraftStore('autumn-jazz-night').read()).toBeNull();
  });

  it('is forgotten when cleared', () => {
    const store = checkoutDraftStore('autumn-jazz-night');
    store.write(DRAFT);
    store.clear();
    expect(store.read()).toBeNull();
    expect(sessionStorage).toHaveLength(0);
  });
});
