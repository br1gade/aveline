import { validateEnv } from './env.validation';

/**
 * Configuration failures must happen at boot, not at the first request that
 * needs them. These pin what is required where.
 */
describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/db' };

  it('accepts a minimal development environment', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('refuses to start without a database URL, naming it', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  // A development default secret in production means anyone can mint a token.
  it.each(['JWT_SECRET', 'CORS_ORIGINS'])('requires %s in production', (key) => {
    const env = { ...base, NODE_ENV: 'production', JWT_SECRET: 'x', CORS_ORIGINS: 'y' };
    delete (env as Record<string, unknown>)[key];

    expect(() => validateEnv(env)).toThrow(new RegExp(key));
  });

  it('does not require production-only settings in development', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });

  it.each(['0', '70000', 'not-a-port', '-1'])('refuses an invalid PORT of %p', (port) => {
    expect(() => validateEnv({ ...base, PORT: port })).toThrow(/PORT/);
  });

  it('defaults PORT and NODE_ENV when unset', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe('3000');
    expect(env.NODE_ENV).toBe('development');
  });
});
