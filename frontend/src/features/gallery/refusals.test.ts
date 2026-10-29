import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { uploadConflict } from './refusals';

const conflict = (message: string) => new ApiError({ status: 409, messages: [message] });

describe('the two upload conflicts, told apart by their words (FR-28)', () => {
  it('knows the photo count limit', () => {
    expect(
      uploadConflict(conflict('uploads: photo count limit reached; remove an unused upload first')),
    ).toBe('count');
  });

  it('knows the storage limit', () => {
    expect(
      uploadConflict(
        conflict(
          'uploads: private storage limit reached; removed files must be reclaimed before retrying',
        ),
      ),
    ).toBe('storage');
  });

  it('falls back to the status’s words for anything else', () => {
    expect(uploadConflict(conflict('Something else'))).toBe('other');
  });
});
