import * as Sentry from '@sentry/nestjs';

/**
 * Error reporting. Deliberately not profiling, metrics or tracing — those are
 * a separate decision and each one costs a sampling budget and a bill.
 *
 * Initialised from main.ts **before the app is created**: Sentry patches
 * modules as they load, so anything imported first is not instrumented.
 *
 * Does nothing without SENTRY_DSN, which is how development stays quiet
 * rather than needing a flag to turn off.
 */
export function initialiseSentry(env: NodeJS.ProcessEnv): boolean {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: env.NODE_ENV ?? 'development',
    release: env.SENTRY_RELEASE,

    // Explicitly off. Tracing is the expensive part and we have not decided
    // we want it. Profiling needs its own integration, which is simply not
    // added — there is no switch to set.
    tracesSampleRate: 0,

    // Sentry v11 does not attach personal data unless asked, so there is no
    // flag to set here. beforeSend below is the real protection: it strips
    // what the SDK collects anyway — headers, URLs and bodies.
    maxValueLength: 2000,

    beforeSend: scrubEvent,
  });

  return true;
}

/**
 * Strips what Sentry would otherwise carry off-site.
 *
 * Two categories: credentials, which would be a breach, and personal data,
 * which for a guest list with EU subjects is a legal problem rather than an
 * untidy one.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request?.headers) {
    for (const header of ['authorization', 'cookie', 'x-api-key']) {
      delete event.request.headers[header];
    }
  }

  // A capability token in a URL would hand over a guest's invitation.
  if (event.request?.url) {
    event.request.url = redactTokens(event.request.url);
  }

  // Bodies on this API carry guest names, emails, dietary notes and
  // passwords. None of it helps diagnose a stack trace.
  delete event.request?.data;

  return event;
}

const TOKEN_PATH = /\/(g|ticket-orders|devices)\/[^/?]+/g;

function redactTokens(url: string): string {
  return url.replace(TOKEN_PATH, (match) => `${match.split('/').slice(0, 2).join('/')}/[token]`);
}

export { Sentry };
