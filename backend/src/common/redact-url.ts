/**
 * A URL with its credentials removed, fit for a log line or an error report.
 *
 * Capability links — a guest's invitation, a ticket order, a ticket code, a
 * vendor brief, a device — carry their credential in the path, so a log of
 * request URLs is a list of working keys: anyone who can read the logs can
 * answer as any guest. Root CLAUDE.md §3 forbids exactly that. Query values
 * are dropped too unless they are known to be harmless, because a name typed
 * into a search box or a bank's callback parameters are no business of the
 * logs either.
 *
 * One function for the request logger, the exception filter and Sentry, so
 * a new capability route is added in one place — and it must be, in the same
 * change that adds the route.
 */
const CAPABILITY_SEGMENTS: [RegExp, string][] = [
  [/(\/invitations\/[^/?#]+\/g\/)[^/?#]+/g, '$1[token]'],
  [/(\/ticket-orders\/)(?!release-expired(?:[/?#]|$))[^/?#]+/g, '$1[token]'],
  [/(\/tickets\/)[^/?#]+/g, '$1[token]'],
  [/(\/briefs\/)[^/?#]+/g, '$1[token]'],
  [/(\/devices\/)[^/?#]+/g, '$1[token]'],
];

/** Query parameters that identify nobody and unlock nothing. */
const HARMLESS_QUERY_KEYS = new Set(['locale', 'limit', 'offset', 'status', 'category', 'format', 'kind']);

export function redactUrl(url: string): string {
  const [path, query] = splitOnce(url, '?');
  const redactedPath = CAPABILITY_SEGMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    path,
  );
  return query === undefined ? redactedPath : `${redactedPath}?${redactQuery(query)}`;
}

/** The same rule for an already-parsed query object, as the request logger has it. */
export function redactQueryObject(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, HARMLESS_QUERY_KEYS.has(key) ? value : '[redacted]']),
  );
}

function redactQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const [key] = splitOnce(pair, '=');
      return HARMLESS_QUERY_KEYS.has(decodeSafely(key)) ? pair : `${key}=[redacted]`;
    })
    .join('&');
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const at = value.indexOf(separator);
  return at === -1 ? [value, undefined] : [value.slice(0, at), value.slice(at + 1)];
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
