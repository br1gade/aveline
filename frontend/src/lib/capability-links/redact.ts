/**
 * A URL with its credentials removed, fit for a log line or an error report.
 *
 * Capability links carry their credential in the path, so a logged URL is a working key (root
 * CLAUDE.md §3). These are the same patterns as backend/src/common/redact-url.ts, which
 * redact.test.ts checks; a new capability route is added here in the same change that adds it.
 */
export const CREDENTIAL_SEGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\/invitations\/[^/?#]+\/g\/)[^/?#]+/g, '$1[token]'],
  [/(\/ticket-orders\/)(?!release-expired(?:[/?#]|$))[^/?#]+/g, '$1[token]'],
  [/(\/tickets\/)[^/?#]+/g, '$1[token]'],
  [/(\/briefs\/)[^/?#]+/g, '$1[token]'],
  [/(\/devices\/)[^/?#]+/g, '$1[token]'],
];

/**
 * Not credentials, but an order number opens its payment's state to anyone, and an invitee's
 * address is personal data. Redacted like the rest; they make no page a capability page.
 */
export const PERSONAL_SEGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\/payments\/)(?!reconcile(?:[/?#]|$))[^/?#]+/g, '$1[order]'],
  [/(\/invites\/)(?!accept(?:[/?#]|$))[^/?#]+/g, '$1[email]'],
];

const PATH_SEGMENTS = [...CREDENTIAL_SEGMENTS, ...PERSONAL_SEGMENTS];

/**
 * The client's own pages that take their credential in the query: a password reset, an email
 * check and an invitation, all as `?token=` (docs/API.md §2). The backend never logs those pages,
 * so this rule is the client's alone.
 */
const QUERY_TOKEN: readonly [RegExp, string] = [/([?&]token=)[^&#\s]+/g, '$1[redacted]'];

/** Query parameters that identify nobody and unlock nothing. */
export const HARMLESS_QUERY_KEYS: ReadonlySet<string> = new Set([
  'locale',
  'limit',
  'offset',
  'status',
  'category',
  'format',
  'kind',
]);

function replaceAll(text: string, rules: ReadonlyArray<readonly [RegExp, string]>): string {
  return rules.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

/**
 * Free text, such as an error's message or stack, with any capability path in it redacted, and
 * any `token=` value. Text is not a URL, so its other query values are left alone.
 */
export function redactText(text: string): string {
  return replaceAll(text, [...PATH_SEGMENTS, QUERY_TOKEN]);
}

/** Whether a path carries a capability token: a guest, ticket or brief link, for example. */
export function isCapabilityPath(path: string): boolean {
  return replaceAll(path, CREDENTIAL_SEGMENTS) !== path;
}

/**
 * Whether a page's address is a credential: a capability path, or one of the client's own pages
 * that take a `?token=` (a password reset, an email check, an invitation to join). Such a response
 * is kept out of caches, referrers and indexes.
 */
export function carriesCapability(url: URL): boolean {
  return isCapabilityPath(url.pathname) || url.searchParams.has('token');
}

export function redactUrl(url: string): string {
  const [path, query] = splitOnce(url, '?');
  const redactedPath = replaceAll(path, PATH_SEGMENTS);
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
