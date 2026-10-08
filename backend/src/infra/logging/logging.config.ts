import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { redactQueryObject, redactUrl } from '../../common/redact-url';

/**
 * Paths whose values never reach a log line.
 *
 * Redaction is a denylist, which is the weaker shape — but the alternative,
 * logging only an allowlist, would make the logs useless for debugging. So
 * the list is kept deliberately broad and anything new that carries a
 * credential or personal data gets added here in the same change.
 */
const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.token',
  'req.body.buyerEmail',
  'req.body.email',
  'res.headers["set-cookie"]',
];

/** Health checks every few seconds would otherwise drown everything else. */
const QUIET_PATHS = ['/api/v1/health/live', '/api/v1/health/ready'];

export function loggingConfig(env: NodeJS.ProcessEnv): Params {
  const isProduction = env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),

      // JSON in production so a log shipper can parse it; readable locally,
      // because a human is the consumer there.
      //
      // Checked for rather than assumed: pino-pretty is a dev dependency, so
      // it is absent from the production image — and pino treats a missing
      // transport target as a fatal error. The app died at boot with
      // "unable to determine transport target" on any image started without
      // NODE_ENV=production, which is a configuration slip that deserves ugly
      // logs, not an outage.
      transport: isPrettyPrintAvailable(isProduction)
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
        : undefined,

      // The whole point: every line carries the id that is also on the
      // response, so a user's screenshot maps to the exact request.
      genReqId: (req: IncomingMessage) => {
        const supplied = req.headers['x-request-id'];
        return typeof supplied === 'string' && supplied.length <= 100 ? supplied : randomUUID();
      },

      redact: { paths: REDACTED, censor: '[redacted]' },

      // Capability links carry their credential in the path, so the URL is
      // rewritten rather than redacted as a field, and the route parameters —
      // the same segments again — are not logged at all.
      serializers: { req: serializeRequest },

      customProps: (req: IncomingMessage & { actor?: { userId: string } }) =>
        req.actor ? { userId: req.actor.userId } : {},

      // 4xx is the client's mistake, not an incident; 5xx is ours.
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, error?: Error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },

      autoLogging: {
        ignore: (req: IncomingMessage) => QUIET_PATHS.includes(req.url ?? ''),
      },
    },
  };
}

/**
 * Whether the human-readable log transport can actually be loaded.
 *
 * Never in production, where JSON is wanted anyway, and only elsewhere if the
 * package is installed — which it is in development and is not in the
 * production image.
 */
function isPrettyPrintAvailable(isProduction: boolean): boolean {
  if (isProduction) return false;

  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/** pino-http's request summary, without the credentials in its URL. */
function serializeRequest(req: Record<string, unknown>): Record<string, unknown> {
  const { params: _params, url, query, ...rest } = req;
  return {
    ...rest,
    url: typeof url === 'string' ? redactUrl(url) : url,
    query: query && typeof query === 'object' ? redactQueryObject(query as Record<string, unknown>) : query,
  };
}
