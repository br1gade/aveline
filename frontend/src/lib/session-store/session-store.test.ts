import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionValue } from './session-store';

const isCount = (value: unknown): value is { count: number } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { count?: unknown }).count === 'number';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('a value kept in this tab', () => {
  it('reads back what was written, and nothing once cleared', () => {
    const store = sessionValue('test:one', isCount);
    expect(store.read()).toBeNull();
    store.write({ count: 2 });
    expect(store.read()).toEqual({ count: 2 });
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('reads a value of another shape, or not JSON, as nothing', () => {
    window.sessionStorage.setItem('test:shape', JSON.stringify({ count: 'two' }));
    window.sessionStorage.setItem('test:json', '{');
    expect(sessionValue('test:shape', isCount).read()).toBeNull();
    expect(sessionValue('test:json', isCount).read()).toBeNull();
  });

  it('carries on when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const store = sessionValue('test:refused', isCount);
    expect(() => store.write({ count: 1 })).not.toThrow();
    expect(store.read()).toBeNull();
  });
});
