import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkoutKeyStore, intentDigest } from './key-store';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('the checkout key kept in this tab (design PD-152)', () => {
  it('keeps one per event, and forgets it when told', () => {
    const store = checkoutKeyStore('anna-davit');
    store.write({ key: 'k1', intent: 'i1' });
    expect(checkoutKeyStore('anna-davit').read()).toEqual({ key: 'k1', intent: 'i1' });
    expect(checkoutKeyStore('another').read()).toBeNull();
    store.write(null);
    expect(checkoutKeyStore('anna-davit').read()).toBeNull();
  });

  it('reads nothing from what it didn’t write', () => {
    const store = checkoutKeyStore('anna-davit');
    store.write({ key: 'k1', intent: 'i1' });
    const [stored] = Object.keys(sessionStorage);
    sessionStorage.setItem(stored ?? '', '{"key": 1}');
    expect(store.read()).toBeNull();
    sessionStorage.setItem(stored ?? '', 'not json');
    expect(store.read()).toBeNull();
  });

  it('works on without storage, which a private window may refuse', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const store = checkoutKeyStore('anna-davit');
    expect(() => store.write({ key: 'k1', intent: 'i1' })).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it('stores what the order asks for only as a digest, never the names and emails in it', async () => {
    const intent = '{"buyerEmail":"ani@example.am","buyerName":"Ani"}';
    const digest = await intentDigest(intent);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(await intentDigest(intent));
    expect(digest).not.toBe(await intentDigest(intent.replace('Ani"', 'Anna"')));
  });
});
