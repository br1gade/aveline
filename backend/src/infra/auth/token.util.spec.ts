import { hashRefreshToken, isExpired, newRefreshToken } from './token.util';

/**
 * Refresh tokens are bearer credentials. These tests guard the two properties
 * that make them safe to store: they are unguessable, and the database never
 * holds the value itself.
 */
describe('refresh tokens', () => {
  it('generates a token long enough not to be guessable', () => {
    expect(newRefreshToken()).toHaveLength(64);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newRefreshToken()));
    expect(tokens.size).toBe(500);
  });

  it('hashes deterministically, so a presented token can be looked up', () => {
    const token = newRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('produces a hash that does not contain the token', () => {
    const token = newRefreshToken();
    expect(hashRefreshToken(token)).not.toContain(token);
  });

  it('gives different tokens different hashes', () => {
    expect(hashRefreshToken(newRefreshToken())).not.toBe(hashRefreshToken(newRefreshToken()));
  });

  describe('isExpired', () => {
    it.each([
      { offsetMs: -1000, expected: true, label: 'a moment ago' },
      { offsetMs: 1000, expected: false, label: 'a moment from now' },
    ])('treats an expiry $label as expired=$expected', ({ offsetMs, expected }) => {
      expect(isExpired(new Date(Date.now() + offsetMs))).toBe(expected);
    });
  });
});
