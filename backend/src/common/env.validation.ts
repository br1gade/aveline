/**
 * Validates configuration at boot.
 *
 * Without this, a missing DATABASE_URL surfaces as a confusing error on the
 * first request that touches the database, and a missing JWT_SECRET in
 * production surfaces as "anyone can mint a staff token". Failing at startup
 * turns both into a deployment that visibly does not come up.
 */
export interface ValidatedEnv extends Record<string, unknown> {
  NODE_ENV: string;
  DATABASE_URL: string;
  PORT: string;
}

/** Required everywhere. */
const ALWAYS_REQUIRED = ['DATABASE_URL'] as const;

/** Required only in production, where a development default is dangerous. */
const PRODUCTION_REQUIRED = ['JWT_SECRET', 'CORS_ORIGINS'] as const;

/** Environment values arrive as unknown; anything not a primitive is absent
 *  rather than stringified into "[object Object]". */
function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function validateEnv(raw: Record<string, unknown>): ValidatedEnv {
  assertRequiredPresent(raw);

  return {
    ...raw,
    NODE_ENV: asText(raw.NODE_ENV) ?? 'development',
    DATABASE_URL: asText(raw.DATABASE_URL) ?? '',
    PORT: String(parsePort(raw.PORT)),
  };
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

function parsePort(value: unknown): number {
  const port = Number(asText(value) ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got "${asText(value) ?? ''}"`);
  }
  return port;
}
