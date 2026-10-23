/**
 * A URL with its credentials removed, fit for a log line or an error report.
 *
 * Capability links carry their credential in the path, so a logged URL is a working key (root
 * CLAUDE.md §3). These are the same patterns as backend/src/common/redact-url.ts; a new capability
 * route is added here in the same change that adds it.
 */
const CAPABILITY_SEGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\/invitations\/[^/?#]+\/g\/)[^/?#]+/g, '$1[token]'],
  [/(\/ticket-orders\/)(?!release-expired(?:[/?#]|$))[^/?#]+/g, '$1[token]'],
  [/(\/tickets\/)[^/?#]+/g, '$1[token]'],
  [/(\/briefs\/)[^/?#]+/g, '$1[token]'],
  [/(\/devices\/)[^/?#]+/g, '$1[token]'],
];

/** Query parameters that identify nobody and unlock nothing. */
const HARMLESS_QUERY_KEYS = new Set([
  'locale',
  'limit',
  'offset',
  'status',
  'category',
  'format',
  'kind',
]);

/**
 * Free text, such as an error's message or stack, with any capability path in it redacted. Only
 * the path patterns apply: text is not a URL, so its question marks are left alone.
 */
export function redactText(text: string): string {
  return CAPABILITY_SEGMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

/** Whether a path carries a capability token: a guest, ticket or brief link, for example. */
export function isCapabilityPath(path: string): boolean {
  return redactText(path) !== path;
}

export function redactUrl(url: string): string {
  const [path, query] = splitOnce(url, '?');
  const redactedPath = CAPABILITY_SEGMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    path,
  );
  return query === undefined ? redactedPath : `${redactedPath}?${redactQuery(query)}`;
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
