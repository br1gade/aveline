import { validateEnv } from './env.validation';

/**
 * Configuration failures must happen at boot, not at the first request that
 * needs them. These pin what is required where.
 */
describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/db', NODE_ENV: 'development' };

  it('accepts a minimal development environment', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('refuses to start without a database URL, naming it', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
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

  it('defaults PORT when unset', () => {
    expect(validateEnv(base).PORT).toBe('3000');
  });

  /**
   * NODE_ENV used to default to development, and every development shortcut
   * — password-reset links returned over HTTP, a default JWT secret, the fake
   * payment gateway, the open API schema — switched on for anything that was
   * not exactly "production". One missing variable on a server handed out
   * account-takeover links. Now there is no default to fall into.
   */
  it.each([undefined, '', 'prod', 'Production', 'staging'])(
    'refuses to start with NODE_ENV %p, naming the accepted values',
    (nodeEnv) => {
      expect(() => validateEnv({ DATABASE_URL: base.DATABASE_URL, NODE_ENV: nodeEnv })).toThrow(
        /NODE_ENV.*development, test or production/,
      );
    },
  );
});
