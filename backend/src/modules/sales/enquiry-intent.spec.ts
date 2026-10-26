import { intentFingerprint, sameIntent, validateIdempotencyKey } from './enquiry-intent';

describe('canonical private command receipts', () => {
  const keyring = { current: 'v1', keys: { v1: 'x'.repeat(32), old: 'y'.repeat(32) } };
  it('sorts nested intent fields while retaining null and omission', () => {
    const first = intentFingerprint({ contact: { name: 'Anna', email: null }, expectedRevision: 2 }, keyring);
    expect(sameIntent(first, { expectedRevision: 2, contact: { email: null, name: 'Anna' } }, keyring)).toBe(true);
    expect(sameIntent(first, { expectedRevision: 2, contact: { name: 'Anna' } }, keyring)).toBe(false);
    expect(sameIntent(null, {}, keyring)).toBe(false);
  });
  it.each(['', 'short', 'line\nbreak', 'ä'.repeat(8), 'x'.repeat(129)])('rejects invalid key %s', (key) => {
    expect(() => validateIdempotencyKey(key)).toThrow('Idempotency-Key');
  });
});
