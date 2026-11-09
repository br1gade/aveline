import { afterEach, describe, expect, it, vi } from 'vitest';

import { forgetOrder, heldOrder, holdOrder } from './token-store';

/** Made at run time: no committed fixture holds a token (frontend CLAUDE.md §10). */
const TOKEN = `tok-${crypto.randomUUID()}`;
const OTHER = `tok-${crypto.randomUUID()}`;

afterEach(() => {
  vi.restoreAllMocks();
  forgetOrder();
  sessionStorage.clear();
});

describe('the order this tab holds', () => {
  it('keeps the token in this tab only, under one key', () => {
    holdOrder({ accessToken: TOKEN });
    expect(heldOrder()).toEqual({ accessToken: TOKEN });
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it('holds only the latest order', () => {
    holdOrder({ accessToken: TOKEN });
    holdOrder({ accessToken: OTHER });
    expect(heldOrder()).toEqual({ accessToken: OTHER });
  });

  it('holds it in memory when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    holdOrder({ accessToken: TOKEN });
    expect(heldOrder()).toEqual({ accessToken: TOKEN });
  });

  it('reads nothing from a value it did not write', () => {
    sessionStorage.setItem('aveline-ticket-order', '{"accessToken":42}');
    expect(heldOrder()).toBeNull();
    sessionStorage.setItem('aveline-ticket-order', 'not json');
    expect(heldOrder()).toBeNull();
  });

  it('forgets the order', () => {
    holdOrder({ accessToken: TOKEN });
    forgetOrder();
    expect(heldOrder()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
