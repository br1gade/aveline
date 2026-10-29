import type { Invitation } from '@/features/invitation-renderer';

/** A personal invitation with a household of two, the link holder first. */
export function personalInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    slug: 'anna-davit',
    isAcceptingResponses: true,
    template: 'classic',
    theme: {},
    allowedFonts: [],
    musicUrl: null,
    coverUrl: null,
    locale: 'en',
    availableLocales: ['en'],
    event: {
      type: 'WEDDING',
      title: 'Anna & Davit',
      hosts: 'Anna & Davit',
      startsAt: '2027-06-12T12:00:00.000Z',
      endsAt: null,
      timezone: 'Asia/Yerevan',
      sides: { a: 'Anna', b: 'Davit' },
    },
    guest: {
      id: 'guest-1',
      name: 'Armen Petrosyan',
      locale: 'en',
      household: {
        name: 'Petrosyan family',
        seatsAllotted: 3,
        members: [
          { id: 'guest-1', name: 'Armen Petrosyan' },
          { id: 'guest-2', name: 'Lusine Petrosyan' },
        ],
      },
      rsvp: null,
    },
    blocks: [],
    rsvpFields: {},
    rsvpQuestions: [],
    ...overrides,
  };
}
