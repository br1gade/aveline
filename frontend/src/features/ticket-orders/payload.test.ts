import { describe, expect, it } from 'vitest';

import { linkBody, linkCandidates, registerBody } from './payload';
import { readOrderDetail } from './read';
import { LEGACY_TICKET, orderDetailWire } from './test-data';

describe('linking a ticket to an invited guest', () => {
  it('names the guest it expects: none for an unlinked ticket, the current one otherwise', () => {
    const legacy = readOrderDetail(orderDetailWire({ tickets: [LEGACY_TICKET] })).tickets[0]!;
    expect(linkBody(legacy, 'g-lusine')).toEqual({
      guestId: 'g-lusine',
      expectedGuestId: null,
      keepExistingAnswers: true,
    });
    const named = readOrderDetail(orderDetailWire()).tickets[0]!;
    expect(linkBody(named, 'g-lusine')).toEqual({
      guestId: 'g-lusine',
      expectedGuestId: 'g-anna',
      keepExistingAnswers: true,
    });
  });

  it('offers every guest on the list but the erased and the one already on the ticket', () => {
    const households = [
      {
        name: 'Petrosyan family',
        guests: [
          { id: 'g-lusine', name: 'Lusine Petrosyan', isErased: false },
          { id: 'g-gone', name: 'Removed', isErased: true },
        ],
      },
      { name: 'Anna Sargsyan', guests: [{ id: 'g-anna', name: 'Anna Sargsyan', isErased: false }] },
    ];
    const named = readOrderDetail(orderDetailWire()).tickets[0]!;
    expect(linkCandidates(households, named)).toEqual([
      { guestId: 'g-lusine', label: 'Lusine Petrosyan (Petrosyan family)' },
    ]);
  });
});

describe('registering who holds a legacy ticket', () => {
  it('sends the person for this ticket’s type, with the current attendance revision', () => {
    expect(registerBody({ ticketTypeId: 'general', firstName: 'Ani' }, 3)).toEqual({
      attendee: { ticketTypeId: 'general', firstName: 'Ani' },
      attendanceRevision: 3,
    });
  });
});
