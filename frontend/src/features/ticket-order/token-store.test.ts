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
  it('keeps the token and the event in this tab only, under one key', () => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz' });
    expect(heldOrder()).toEqual({ accessToken: TOKEN, slug: 'autumn-jazz' });
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it('keeps the event when the same order is held again from its link', () => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz' });
    holdOrder({ accessToken: TOKEN });
    expect(heldOrder()).toEqual({ accessToken: TOKEN, slug: 'autumn-jazz' });
  });

  it('forgets the event when another order replaces it', () => {
    holdOrder({ accessToken: TOKEN, slug: 'autumn-jazz' });
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
