import { afterEach, describe, expect, it, vi } from 'vitest';

import { orderSnapshot } from './order-snapshot';
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

  it('keeps the last read with its own order only (design PD-202)', () => {
    const read = {
      order: { status: 'PAID', tickets: [], attendees: [], items: [] },
      receivedAt: 1,
    };
    holdOrder({ accessToken: TOKEN });
    sessionStorage.setItem('aveline-ticket-order-read', JSON.stringify(read));
    holdOrder({ accessToken: TOKEN, eventSlug: 'autumn-jazz-night' });
    expect(orderSnapshot.read()).toEqual(read);
    holdOrder({ accessToken: OTHER });
    expect(orderSnapshot.read()).toBeNull();
    sessionStorage.setItem('aveline-ticket-order-read', JSON.stringify(read));
    forgetOrder();
    expect(orderSnapshot.read()).toBeNull();
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

  it('keeps the event the order was placed for, and nothing else of it (PD-152)', () => {
    holdOrder({ accessToken: TOKEN, eventSlug: 'autumn-jazz-night' });
    expect(heldOrder()).toEqual({ accessToken: TOKEN, eventSlug: 'autumn-jazz-night' });
    forgetOrder();
    sessionStorage.setItem(
      'aveline-ticket-order',
      JSON.stringify({ accessToken: TOKEN, eventSlug: 7 }),
    );
    expect(heldOrder()).toBeNull();
  });

  it('forgets the order', () => {
    holdOrder({ accessToken: TOKEN });
    forgetOrder();
    expect(heldOrder()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
