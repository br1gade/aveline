import { jwtSecret } from './jwt-secret';

/**
 * `.env.example` leaves JWT_SECRET empty. Empty must mean unset: kept as `''`,
 * development signed every token with an empty key and each sign-in was a 500.
 */
describe('jwtSecret', () => {
  it.each([undefined, ''])('falls back to the development secret when JWT_SECRET is %p in development', (secret) => {
    expect(jwtSecret(secret, 'development')).toMatch(/^development-only-/);
  });

  it.each([undefined, ''])('refuses to boot in production when JWT_SECRET is %p', (secret) => {
    expect(() => jwtSecret(secret, 'production')).toThrow('JWT_SECRET must be set');
  });

  it('uses a configured secret', () => {
    expect(jwtSecret('a-real-secret', 'production')).toBe('a-real-secret');
  });
});
