// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { keptFiles } from './tickets-worker';

const ORIGIN = 'https://aveline.test';

describe('what the tickets worker is told to keep (design PD-202)', () => {
  it('keeps this origin’s hashed files once each, and nothing with a query or elsewhere', () => {
    expect(
      keptFiles(
        [
          `${ORIGIN}/assets/entry-abc.js`,
          `${ORIGIN}/assets/entry-abc.js`,
          `${ORIGIN}/assets/root-def.css`,
          `${ORIGIN}/assets/chunk.js?token=secret`,
          `${ORIGIN}/api/v1/ticket-orders/secret`,
          `${ORIGIN}/tickets/secret`,
          'https://elsewhere.test/assets/entry-abc.js',
          'not a url',
        ],
        ORIGIN,
      ),
    ).toEqual(['/assets/entry-abc.js', '/assets/root-def.css']);
  });
});
