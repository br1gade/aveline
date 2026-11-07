import { describe, expect, it } from 'vitest';

import {
  captionProblem,
  chosenPhotoProblem,
  captionToSend,
  choiceProblem,
  photoProblem,
  PHOTO_LIMIT_BYTES,
} from './rules';

describe('what a guest may share (docs/API.md §11)', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])('takes %s', (type) => {
    expect(photoProblem({ type, size: 1 })).toBeNull();
  });

  it.each(['image/heic', 'image/svg+xml', 'image/gif', 'application/pdf', ''])(
    'refuses %j before sending',
    (type) => {
      expect(photoProblem({ type, size: 1 })).toBe('type');
    },
  );

  it('takes 10 MiB exactly, and refuses a byte more or an empty file', () => {
    expect(PHOTO_LIMIT_BYTES).toBe(10_485_760);
    expect(photoProblem({ type: 'image/jpeg', size: 10_485_760 })).toBeNull();
    expect(photoProblem({ type: 'image/jpeg', size: 10_485_761 })).toBe('size');
    expect(photoProblem({ type: 'image/jpeg', size: 0 })).toBe('empty');
  });

  it('takes at most twenty photos at once, a guest’s whole allowance', () => {
    expect(choiceProblem(0)).toBe('none');
    expect(choiceProblem(1)).toBeNull();
    expect(choiceProblem(20)).toBeNull();
    expect(choiceProblem(21)).toBe('tooMany');
  });
});

describe('a caption', () => {
  it('is trimmed, and left out when empty', () => {
    expect(captionToSend('  At the church  ')).toBe('At the church');
    expect(captionToSend('   ')).toBeUndefined();
  });

  it('holds 500 characters after trimming, and no null character', () => {
    expect(captionProblem(` ${'a'.repeat(500)} `)).toBeNull();
    expect(captionProblem('a'.repeat(501))).toBe('tooLong');
    expect(captionProblem(`a${String.fromCharCode(0)}b`)).toBe('invalid');
  });
});

describe('a photo as it is chosen, before it is made smaller (PD-150)', () => {
  const over = 10 * 1024 * 1024 + 1;

  it.each(['image/jpeg', 'image/webp', 'image/png', 'image/avif'])(
    'lets %s over 10 MiB through, as it is made smaller before it goes',
    (type) => {
      expect(chosenPhotoProblem({ type, size: over })).toBeNull();
    },
  );

  it('still refuses an empty file, HEIC and SVG', () => {
    expect(chosenPhotoProblem({ type: 'image/jpeg', size: 0 })).toBe('empty');
    expect(chosenPhotoProblem({ type: 'image/heic', size: 1 })).toBe('type');
    expect(chosenPhotoProblem({ type: 'image/svg+xml', size: 1 })).toBe('type');
  });
});
