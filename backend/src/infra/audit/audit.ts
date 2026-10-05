/**
 * What is worth recording, and what is not.
 *
 * An audit trail that records everything is a log, and nobody reads logs to
 * answer "who changed this". The entries that matter are the ones a customer
 * might later dispute: money moved, access granted, a guest list altered,
 * someone's data erased. Reads are excluded — they are the overwhelming
 * majority of traffic and recording them would bury the handful of writes that
 * someone actually has to account for.
 *
 * Pure, because "is this worth recording" is a judgement that should be
 * reviewable in one table rather than scattered across decorators.
 */
export interface AuditableRequest {
  method: string;
  /** The route pattern, not the filled-in URL: `/events/:eventId/guests`. */
  route: string;
}

/** Methods that change something. A GET never needs accounting for. */
const WRITING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Routes excluded even though they write.
 *
 * Each for a stated reason, because an exclusion list nobody can justify grows
 * until the trail is empty:
 *
 * - **Authentication** writes constantly and its own records live in `Session`,
 *   which is more detailed than this would be.
 * - **Webhooks** are called by providers, not people, so there is no actor to
 *   record and the provider's own id is already on the row.
 * - **Sweeps** triggered over HTTP are the same work the cron does, which is
 *   already reported through Sentry check-ins.
 */
const EXCLUDED_PREFIXES: readonly string[] = [
  '/auth/',
  '/webhooks/',
  '/ticket-orders/release-expired',
  '/payments/reconcile',
];

export function isAuditable(request: AuditableRequest): boolean {
  if (!WRITING_METHODS.has(request.method.toUpperCase())) return false;

  const route = normalizeRoute(request.route);
  return !EXCLUDED_PREFIXES.some((prefix) => route.startsWith(prefix));
}

/**
 * Strips the version prefix so a trail survives `/api/v2`.
 *
 * An audit query asking "who touched the guest list" should not have to know
 * which API version the caller used.
 */
export function normalizeRoute(route: string): string {
  return route.replace(/^\/api\/v\d+/, '');
}

/**
 * A short name for what happened, derived from the request.
 *
 * `POST /events/:eventId/guests/import` becomes
 * `events.guests.import.create` — readable, groupable, and stable when a path
 * parameter is renamed.
 */
export function actionNameFor(request: AuditableRequest): string {
  const segments = normalizeRoute(request.route)
    .split('/')
    .filter((segment) => segment.length > 0 && !segment.startsWith(':'));

  return [...segments, VERBS[request.method.toUpperCase()] ?? 'change'].join('.');
}

const VERBS: Record<string, string> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'replace',
  DELETE: 'delete',
};
