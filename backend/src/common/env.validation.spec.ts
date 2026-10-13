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
  it.each(['JWT_SECRET', 'CORS_ORIGINS', 'PUBLIC_APP_URL'])('requires %s in production', (key) => {
    const env = { ...base, NODE_ENV: 'production', JWT_SECRET: 'x', CORS_ORIGINS: 'y', PUBLIC_APP_URL: 'https://aveline.am' };
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

  // B89: `ACCESS_TOKEN_TTL_SECONDS=15m` became NaN, and every login, register
  // and refresh then failed with a 500.
  it.each([
    ['ACCESS_TOKEN_TTL_SECONDS', '15m'],
    ['ACCESS_TOKEN_TTL_SECONDS', '0'],
    ['REFRESH_TOKEN_TTL_DAYS', 'thirty'],
  ])('refuses to start with %s=%s, naming it', (key, value) => {
    expect(() => validateEnv({ ...base, [key]: value })).toThrow(new RegExp(key));
  });

  it('accepts whole-number token lifetimes', () => {
    expect(() => validateEnv({ ...base, ACCESS_TOKEN_TTL_SECONDS: '900', REFRESH_TOKEN_TTL_DAYS: '30' })).not.toThrow();
  });

  it.each(['1', 'yes', '', 'TRUE'])('rejects an ambiguous PILOT_MODE of %p', (value) => {
    expect(() => validateEnv({ ...base, PILOT_MODE: value })).toThrow(/PILOT_MODE/);
  });

  it.each([
    ['EMAIL_SENDS_PER_MINUTE', '0'], ['EMAIL_SENDS_PER_MINUTE', '60/min'],
    ['EMAIL_SENDS_PER_DAY', '-1'], ['EMAIL_SENDS_PER_DAY', '1000001'],
    ['EMAIL_SEND_BURST', '1.5'], ['EMAIL_SEND_BURST', ''],
    ['EMAIL_SEND_CONCURRENCY', '21'], ['EMAIL_FEEDBACK_SECRET', 'short'],
  ])('rejects unsafe email configuration %s', (key, value) => {
    expect(() => validateEnv({ ...base, [key]: value })).toThrow(key);
  });
});
