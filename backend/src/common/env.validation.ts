/**
 * Validates configuration at boot.
 *
 * Without this, a missing DATABASE_URL surfaces as a confusing error on the
 * first request that touches the database, and a missing JWT_SECRET in
 * production surfaces as "anyone can mint a staff token". Failing at startup
 * turns both into a deployment that visibly does not come up.
 */
import { ENVIRONMENTS } from './environment';

export interface ValidatedEnv extends Record<string, unknown> {
  NODE_ENV: string;
  DATABASE_URL: string;
  PORT: string;
}

/** Required everywhere. */
const ALWAYS_REQUIRED = ['DATABASE_URL'] as const;

/** Required only in production, where a development default is dangerous. */
const PRODUCTION_REQUIRED = ['JWT_SECRET', 'CORS_ORIGINS', 'PUBLIC_APP_URL'] as const;

/** Environment values arrive as unknown; anything not a primitive is absent
 *  rather than stringified into "[object Object]". */
function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function validateEnv(raw: Record<string, unknown>): ValidatedEnv {
  const nodeEnv = recognisedNodeEnv(raw.NODE_ENV);
  assertRequiredPresent(raw);

  assertWholeNumbers(raw, ['ACCESS_TOKEN_TTL_SECONDS', 'REFRESH_TOKEN_TTL_DAYS']);
  assertEmailQuotaSettings(raw);
  assertExportRetention(raw);
  const feedbackSecret = asText(raw.EMAIL_FEEDBACK_SECRET);
  if (feedbackSecret && feedbackSecret.length < 32) throw new Error('EMAIL_FEEDBACK_SECRET must have at least 32 characters');
  if (raw.PILOT_MODE !== undefined && !['true', 'false'].includes(asText(raw.PILOT_MODE) ?? '')) {
    throw new Error('PILOT_MODE must be true or false');
  }

  return {
    ...raw,
    NODE_ENV: nodeEnv,
    DATABASE_URL: asText(raw.DATABASE_URL) ?? '',
    PORT: String(parsePort(raw.PORT)),
  };
}

/**
 * Settings read with `Number()`. `ACCESS_TOKEN_TTL_SECONDS=15m` became NaN,
 * and every login, register and refresh then failed with a 500 — found by a
 * user, not at boot.
 */
function assertWholeNumbers(raw: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const value = asText(raw[key]);
    if (value === undefined || value === '') continue;
    if (!/^\d+$/.test(value) || Number(value) <= 0) {
      throw new Error(`${key} must be a whole number above zero, got "${value}"`);
    }
  }
}

function assertEmailQuotaSettings(raw: Record<string, unknown>): void {
  const maximums = { EMAIL_SENDS_PER_MINUTE: 60000, EMAIL_SENDS_PER_DAY: 1000000, EMAIL_SEND_BURST: 1000, EMAIL_SEND_CONCURRENCY: 20 };
  assertWholeNumbers(raw, Object.keys(maximums));
  for (const [key, maximum] of Object.entries(maximums)) {
    const value = asText(raw[key]);
    if (value !== undefined && (value === '' || Number(value) > maximum)) throw new Error(`${key} must be between 1 and ${maximum}`);
  }
}

function assertRequiredPresent(raw: Record<string, unknown>): void {
  const isProduction = raw.NODE_ENV === 'production';
  const required = [
    ...ALWAYS_REQUIRED,
    ...(isProduction ? PRODUCTION_REQUIRED : []),
    // An unauthenticated bot webhook lets anyone who guesses a guest token
    // register their own chat and receive that guest's invitation. Required
    // only once a bot exists, so a deployment without Telegram is unaffected.
    ...(isProduction && raw.TELEGRAM_BOT_TOKEN ? (['TELEGRAM_WEBHOOK_SECRET'] as const) : []),
  ];

  const missing = required.filter((key) => !raw[key]);
  if (missing.length === 0) return;

  throw new Error(
    `Missing required configuration: ${missing.join(', ')}` +
      (isProduction ? ' (required because NODE_ENV=production)' : ''),
  );
}

/**
 * No default. A default of "development" is what let one missing variable on
 * a server switch on every development shortcut — see `environment.ts`.
 */
function recognisedNodeEnv(value: unknown): string {
  const nodeEnv = asText(value);
  if (nodeEnv && (ENVIRONMENTS as readonly string[]).includes(nodeEnv)) return nodeEnv;
  throw new Error(
    `NODE_ENV must be set to development, test or production; got "${nodeEnv ?? ''}". ` +
      'There is no default, so a server cannot run development shortcuts by omission.',
  );
}

function parsePort(value: unknown): number {
  const port = Number(asText(value) ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got "${asText(value) ?? ''}"`);
  }
  return port;
}


function assertExportRetention(raw: Record<string, unknown>): void {
  if (raw.EXPORT_RETENTION_DAYS === undefined) return;
  const value = asText(raw.EXPORT_RETENTION_DAYS) ?? '';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 30) throw new Error('EXPORT_RETENTION_DAYS must be a whole number between 1 and 30');
}
