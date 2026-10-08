import { BlockType, InvitationStatus } from '@prisma/client';
import {
  PublishCandidate,
  canTransition,
  isReadableByGuests,
  publishBlockers,
} from './publishing';

const NOW = new Date('2027-01-01T12:00:00.000Z');

const ready = (overrides: Partial<PublishCandidate> = {}): PublishCandidate => ({
  status: InvitationStatus.DRAFT,
  startsAt: new Date('2027-06-12T15:00:00.000Z'),
  blocks: [
    { type: BlockType.HERO, enabled: true },
    { type: BlockType.RSVP, enabled: true },
  ],
  venues: [{ address: 'Yerevan, Abovyan 1' }],
  ...overrides,
});

describe('publishBlockers', () => {
  it('finds nothing wrong with a complete invitation', () => {
    expect(publishBlockers(ready(), NOW)).toEqual([]);
  });

  describe('the RSVP block', () => {
    // A page guests cannot answer is the whole product failing.
    it('blocks when there is no RSVP block', () => {
      const blockers = publishBlockers(
        ready({ blocks: [{ type: BlockType.HERO, enabled: true }] }),
        NOW,
      );

      expect(blockers).toEqual(['Turn on the RSVP block, or guests will have no way to answer']);
    });

    it('blocks when the RSVP block exists but is switched off', () => {
      const blockers = publishBlockers(
        ready({ blocks: [{ type: BlockType.RSVP, enabled: false }] }),
        NOW,
      );

      expect(blockers).toHaveLength(1);
    });
  });

  describe('the venue', () => {
    it('blocks when there is no venue', () => {
      expect(publishBlockers(ready({ venues: [] }), NOW)).toEqual([
        'Add a venue with an address, so guests know where to go',
      ]);
    });

    it.each(['', '   '])('blocks when the only venue has a blank address (%j)', (address) => {
      expect(publishBlockers(ready({ venues: [{ address }] }), NOW)).toHaveLength(1);
    });

    it('is satisfied by any one venue with an address', () => {
      expect(
        publishBlockers(ready({ venues: [{ address: '' }, { address: 'Gyumri' }] }), NOW),
      ).toEqual([]);
    });
  });

  describe('the date', () => {
    it.each([
      { label: 'a minute from now', startsAt: new Date(NOW.getTime() + 60_000), blocked: false },
      { label: 'exactly now', startsAt: NOW, blocked: true },
      { label: 'yesterday', startsAt: new Date(NOW.getTime() - 86_400_000), blocked: true },
    ])('$label → blocked: $blocked', ({ startsAt, blocked }) => {
      expect(publishBlockers(ready({ startsAt }), NOW).length > 0).toBe(blocked);
    });
  });

  // A host fixes the page in one pass rather than one attempt per problem.
  it('reports every blocker at once', () => {
    const blockers = publishBlockers(
      ready({ blocks: [], venues: [], startsAt: new Date(NOW.getTime() - 1) }),
      NOW,
    );

    expect(blockers).toHaveLength(3);
  });
});

describe('canTransition', () => {
  it.each([
    { from: InvitationStatus.DRAFT, to: InvitationStatus.PUBLISHED, allowed: true },
    { from: InvitationStatus.PUBLISHED, to: InvitationStatus.CLOSED, allowed: true },
    { from: InvitationStatus.CLOSED, to: InvitationStatus.PUBLISHED, allowed: true },
    // No way back to draft: it would turn every sent link into a 404.
    { from: InvitationStatus.PUBLISHED, to: InvitationStatus.DRAFT, allowed: false },
    { from: InvitationStatus.CLOSED, to: InvitationStatus.DRAFT, allowed: false },
    // A draft has nothing to close.
    { from: InvitationStatus.DRAFT, to: InvitationStatus.CLOSED, allowed: false },
    // Already there.
    { from: InvitationStatus.PUBLISHED, to: InvitationStatus.PUBLISHED, allowed: false },
  ])('$from → $to: $allowed', ({ from, to, allowed }) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});

describe('isReadableByGuests', () => {
  // Closing stops responses; it must not hide the venue from people who are
  // coming.
  it.each([
    { status: InvitationStatus.PUBLISHED, readable: true },
    { status: InvitationStatus.CLOSED, readable: true },
    { status: InvitationStatus.DRAFT, readable: false },
  ])('$status → $readable', ({ status, readable }) => {
    expect(isReadableByGuests(status)).toBe(readable);
  });
});
