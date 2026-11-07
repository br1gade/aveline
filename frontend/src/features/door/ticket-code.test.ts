import { describe, expect, it } from 'vitest';

import { readCode } from './ticket-code';

describe('reading a typed ticket code', () => {
  it.each([
    ['a1b2-c3d4', 'A1B2-C3D4'],
    ['  sample_1\t', 'SAMPLE_1'],
    ['ABCD EFGH IJKL', 'ABCDEFGHIJKL'],
  ])('sends %j as the backend stores it', (typed, code) => {
    expect(readCode(typed)).toEqual({ kind: 'ready', code });
  });

  it.each(['', '   ', '\t '])('treats %j as nothing typed', (typed) => {
    expect(readCode(typed)).toEqual({ kind: 'empty' });
  });

  it.each(['АБВГ', 'ԱԲԳԴ', 'A1B2Ж', 'CAFÉ'])('asks for a Latin keyboard for %j', (typed) => {
    expect(readCode(typed)).toEqual({ kind: 'notLatin' });
  });
});
