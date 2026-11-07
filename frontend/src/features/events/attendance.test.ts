import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { attendanceRefusal, otherMode, readChanged, readPreview } from './attendance';

const refused = (status: number, message: string) =>
  attendanceRefusal(new ApiError({ status, messages: [message] }));

describe('changing how guests answer', () => {
  it('always changes to the other way', () => {
    expect(otherMode('EVENT_WIDE')).toBe('PER_VENUE');
    expect(otherMode('PER_VENUE')).toBe('EVENT_WIDE');
  });

  it('keeps only what the screens read from the answers', () => {
    const preview = readPreview({
      mode: 'PER_VENUE',
      expectedRevision: 1,
      previewToken: 'a'.repeat(32),
      affected: { guests: 120, responses: 40, seatedGuests: 12, seats: 12 } as never,
      request: {},
    } as never);
    expect(preview).toEqual({
      mode: 'PER_VENUE',
      expectedRevision: 1,
      previewToken: 'a'.repeat(32),
      affected: { guests: 120, responses: 40, seatedGuests: 12 },
    });
    expect(
      readChanged({
        mode: 'PER_VENUE',
        revision: 2,
        notice: {
          requiresReconfirmation: true,
          notificationPath: '/api/v1/invitations/x/notify-changes',
        },
      } as never),
    ).toEqual({
      mode: 'PER_VENUE',
      revision: 2,
      notificationPath: '/api/v1/invitations/x/notify-changes',
    });
  });

  it.each([
    [409, 'expectedRevision: attendance policy changed; preview again', 'stale'],
    [409, 'previewToken: attendance or seating changed; preview again', 'stale'],
    [409, 'transitionId: already used for another policy change', 'stale'],
    [400, 'mode: per-venue attendance needs a guest-facing venue', 'noVenue'],
    [400, 'mode: already using this attendance mode', 'sameMode'],
  ])('reads a %i “%s” as %s', (status, message, kind) => {
    expect(refused(status, message)).toEqual({ kind });
  });

  it('words anything else by its status', () => {
    expect(refused(403, 'Forbidden')).toEqual({
      kind: 'problem',
      problem: { code: 'refused', status: 403 },
    });
    expect(refused(409, 'Something else')).toMatchObject({ kind: 'problem' });
  });
});
