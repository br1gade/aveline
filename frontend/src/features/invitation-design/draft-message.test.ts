import { describe, expect, it } from 'vitest';

import type { Invitation } from '@/features/invitation-renderer';

import { draftMessage, readDraftMessage, READY_MESSAGE } from './draft-message';
import { previewWire } from './test-data';

const ORIGIN = 'http://app.test';
const frame = {} as MessageEventSource;
const invitation = previewWire('en') as Invitation;

function received(data: unknown, origin = ORIGIN, source: MessageEventSource | null = frame) {
  return new MessageEvent('message', { data, origin, source });
}

describe('the draft preview’s messages (PD-153)', () => {
  const expected = { origin: ORIGIN, source: frame };

  it('reads a draft and the frame’s ready, from the app itself and the window expected', () => {
    expect(readDraftMessage(received(draftMessage(invitation)), expected)).toEqual({
      kind: 'draft',
      invitation,
    });
    expect(readDraftMessage(received(READY_MESSAGE), expected)).toEqual({ kind: 'ready' });
  });

  it('ignores a message from another origin, or another window', () => {
    expect(readDraftMessage(received(READY_MESSAGE, 'https://evil.example'), expected)).toBeNull();
    expect(
      readDraftMessage(received(READY_MESSAGE, ORIGIN, {} as MessageEventSource), expected),
    ).toBeNull();
  });

  it('ignores anything that isn’t one of its own messages', () => {
    for (const data of [
      null,
      'ready',
      { type: 'other', kind: 'ready' },
      { ...READY_MESSAGE, kind: 'unknown' },
      { ...draftMessage(invitation), invitation: { blocks: 'no' } },
    ]) {
      expect(readDraftMessage(received(data), expected)).toBeNull();
    }
  });
});
