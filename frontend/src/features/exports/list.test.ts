import { describe, expect, it } from 'vitest';

import { endedIn, mergeSnapshots } from './list';
import { snapshot } from './test-data';

const at = (id: string, minute: number, overrides = {}) =>
  snapshot({
    id,
    createdAt: `2026-10-30T10:${String(minute).padStart(2, '0')}:00.000Z`,
    ...overrides,
  });

describe('the history on screen', () => {
  it('replaces what was read and keeps the rest, newest first', () => {
    const current = [at('b', 2, { status: 'RUNNING' }), at('a', 1)];
    const merged = mergeSnapshots(current, [at('b', 2), at('c', 3, { status: 'QUEUED' })]);
    expect(merged.map((each) => [each.id, each.status])).toEqual([
      ['c', 'QUEUED'],
      ['b', 'COMPLETED'],
      ['a', 'COMPLETED'],
    ]);
  });

  it('keeps the newest fifty, as the API does', () => {
    const current = Array.from({ length: 50 }, (_, index) => at(`old-${index}`, index));
    const merged = mergeSnapshots(current, [at('new', 59)]);
    expect(merged).toHaveLength(50);
    expect(merged[0]?.id).toBe('new');
    expect(merged.some((each) => each.id === 'old-0')).toBe(false);
  });
});

describe('what ended between two reads', () => {
  it('names the exports that were going and have now ended', () => {
    const before = [
      at('a', 1, { status: 'RUNNING' }),
      at('b', 2, { status: 'QUEUED' }),
      at('c', 3, { status: 'QUEUED' }),
    ];
    const read = [
      at('a', 1),
      at('b', 2, { status: 'FAILED', isDownloadable: false }),
      at('c', 3, { status: 'RUNNING' }),
      at('d', 4),
    ];
    expect(endedIn(before, read).map((each) => each.id)).toEqual(['a', 'b']);
  });

  it('names nothing that had already ended or was never on screen', () => {
    expect(endedIn([at('a', 1)], [at('a', 1), at('d', 4)])).toEqual([]);
  });
});
