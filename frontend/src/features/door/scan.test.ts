// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import jsQR from 'jsqr';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';

import { cameraProblemOf, centreSquare, createScanGate, readScannedCode } from './scan';

const ISSUE = readFileSync(
  join(import.meta.dirname, '../../../../backend/src/modules/ticketing/issue-attendees.ts'),
  'utf8',
);

describe('what the camera read', () => {
  it('is pinned to how the backend makes a code', () => {
    // 12 random bytes are 16 base64url characters, in capitals.
    expect(ISSUE).toContain("randomBytes(12).toString('base64url').toUpperCase()");
  });

  it.each([['ABCDEFGH-JKLM_12'], ['0000000000000000'], ['--__--__--__--__']])(
    'takes %s as a ticket, as it came',
    (read) => {
      expect(readScannedCode(read)).toEqual({ kind: 'ticket', code: read });
    },
  );

  it.each([
    ['small letters, which no code holds', 'abcdefgh12345678'],
    ['one small letter', 'ABCDEFGH1234567a'],
    ['one short', 'ABCDEFGH1234567'],
    ['one long', 'ABCDEFGH123456789'],
    ['empty', ''],
    ['a space', 'ABCDEFGH 1234567'],
    ['outside the alphabet', 'ABCDEFGH1234567='],
    ['a trailing line', 'ABCDEFGH12345678\n'],
    ['a guest link', 'https://aveline.am/invitations/anna-davit/g/abcdefgh12345678'],
    ['a site', 'https://example.com/'],
    ['a contact', 'BEGIN:VCARD'],
    ['Cyrillic', 'АВСDEFGH12345678'],
  ])('is not a ticket, so is never sent: %s', (_name, read) => {
    expect(readScannedCode(read)).toEqual({ kind: 'notTicket' });
  });
});

describe('a code off a real drawing', () => {
  it.each(['ABCDEFGH12345678', 'AB-CD_EF-GH_IJ-K'])('comes through as itself: %s', (code) => {
    const { data: modules, size } = encode(code, { ecc: 'M', border: 4 });
    const SCALE = 4;
    const side = size * SCALE;
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const at = (y * side + x) * 4;
        if (modules[Math.floor(y / SCALE)]?.[Math.floor(x / SCALE)]) pixels.fill(0, at, at + 3);
      }
    }
    const read = jsQR(pixels, side, side, { inversionAttempts: 'dontInvert' })?.data ?? '';
    expect(readScannedCode(read)).toEqual({ kind: 'ticket', code });
  });
});

describe('the part of a frame to read', () => {
  it.each([
    [1920, 1080, { x: 420, y: 0, side: 1080, size: 640 }],
    [720, 1280, { x: 0, y: 280, side: 720, size: 640 }],
    [640, 480, { x: 80, y: 0, side: 480, size: 480 }],
    [320, 320, { x: 0, y: 0, side: 320, size: 320 }],
  ])('of %i by %i is what the square viewfinder shows, never enlarged', (width, height, part) => {
    expect(centreSquare(width, height)).toEqual(part);
  });
});

describe('a code still in view', () => {
  const HOLD = 5000;

  it('goes once, however long it stays in view', () => {
    const gate = createScanGate();
    expect(gate.offer('A', 0, true)).toBe(true);
    for (let now = 200; now <= 20_000; now += 200) expect(gate.offer('A', now, true)).toBe(false);
  });

  it('goes again only once it has been out of view for the whole hold', () => {
    const gate = createScanGate();
    gate.offer('A', 0, true);
    expect(gate.offer('A', HOLD - 1, true)).toBe(false);
    expect(gate.offer('A', HOLD - 1 + HOLD, true)).toBe(true);
  });

  it('holds two tickets in view apart, without either going twice', () => {
    const gate = createScanGate();
    expect(gate.offer('A', 0, true)).toBe(true);
    expect(gate.offer('B', 100, true)).toBe(true);
    expect(gate.offer('A', 200, true)).toBe(false);
    expect(gate.offer('B', 300, true)).toBe(false);
  });

  it('holds a code through a slow answer, however long it stays in view', () => {
    const gate = createScanGate();
    expect(gate.offer('A', 0, true)).toBe(true);
    for (let now = 200; now <= 10_000; now += 200) expect(gate.offer('A', now, false)).toBe(false);
    expect(gate.offer('A', 10_200, true)).toBe(false);
  });

  it('leaves a new code to go once the door is free, not while it isn’t', () => {
    const gate = createScanGate();
    expect(gate.offer('B', 0, false)).toBe(false);
    expect(gate.offer('B', 200, true)).toBe(true);
  });
});

describe('a camera that would not open', () => {
  it.each([
    ['NotAllowedError', 'refused'],
    ['SecurityError', 'refused'],
    ['NotFoundError', 'none'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['NotSupportedError', 'busy'],
    ['SomethingNew', 'busy'],
  ])('%s is %s', (name, problem) => {
    expect(cameraProblemOf(new DOMException('x', name))).toBe(problem);
  });

  it('gives back what is not the browser’s', () => {
    const bug = new TypeError('a bug');
    expect(() => cameraProblemOf(bug)).toThrow(bug);
  });
});
