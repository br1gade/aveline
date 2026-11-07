import type { Invitation, InvitationBlock } from './types';

/**
 * Test data shaped like the backend's demo event (backend/prisma/seed.ts). Every name, address and
 * number is fictional, and no capability token appears (frontend/CLAUDE.md §10).
 */
export function block(type: string, fields: Partial<InvitationBlock> = {}): InvitationBlock {
  return {
    type,
    sortOrder: 0,
    variant: null,
    settings: null,
    content: {},
    media: [],
    data: null,
    ...fields,
  };
}

export const VENUES = [
  {
    id: 'venue-chapel',
    role: 'CEREMONY',
    name: 'Chapel of the Garden',
    address: '12 Example Street, Yerevan',
    latitude: null,
    longitude: null,
    mapUrl: 'https://maps.example.com/?q=chapel',
    arriveAt: '2027-06-12T09:45:00.000Z',
  },
  {
    id: 'venue-maison',
    role: 'RECEPTION',
    name: 'Maison Lumière',
    address: '40 Example Avenue, Yerevan',
    latitude: null,
    longitude: null,
    mapUrl: null,
    arriveAt: null,
  },
];

/** The demo event's blocks, in its order. The organiser is a fictional person, not Aveline (PD-20). */
export const FIXTURE_BLOCKS: InvitationBlock[] = [
  block('HERO', { content: { title: 'Anna & Davit' } }),
  block('STORY', {
    content: { body: 'We would be glad to share this important day with you.' },
  }),
  block('COUNTDOWN', {
    data: { target: '2027-06-12T12:00:00.000Z', timezone: 'Asia/Yerevan' },
  }),
  block('VENUE', { data: VENUES }),
  block('MAP', { data: VENUES }),
  block('TIMELINE', {
    data: [
      { label: 'Ceremony', occursAt: '2027-06-12T10:00:00.000Z', venueId: 'venue-chapel' },
      { label: 'Dinner', occursAt: '2027-06-12T14:00:00.000Z', venueId: null },
    ],
  }),
  block('DRESS_CODE', {
    content: { body: 'Evening wear' },
    settings: { palette: ['#2E2A26', '#C9A227', '#7A8B74'] },
  }),
  block('RSVP'),
  block('CONTACT', { content: { organizer: 'Mariam Sargsyan', phone: '+374 00 000000' } }),
];

export function invitationFixture(overrides: Partial<Invitation> = {}): Invitation {
  return {
    slug: 'anna-davit',
    isAcceptingResponses: true,
    template: 'classic',
    theme: { palette: 'ivory-gold', font: 'Cormorant Garamond' },
    allowedFonts: [],
    musicUrl: null,
    coverUrl: null,
    locale: 'en',
    availableLocales: ['hy', 'en'],
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
    blocks: FIXTURE_BLOCKS,
    rsvpQuestions: [],
    ...overrides,
  };
}
