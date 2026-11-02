import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * An open CORS policy lets any site call the API with a user's credentials.
 * Development stays permissive; production must name its origins.
 *
 * The request id is exposed so a client on another origin can quote it in an
 * error report. Ten minutes of preflight caching spares every write an extra
 * round trip; browsers cap it lower anyway (Chromium at two hours).
 */
export function corsOptionsFor(canUseShortcuts: boolean, env: NodeJS.ProcessEnv): CorsOptions {
  const origins = env.CORS_ORIGINS?.split(',').map((origin) => origin.trim());
  return {
    origin: canUseShortcuts ? true : (origins ?? false),
    credentials: true,
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  };
}
