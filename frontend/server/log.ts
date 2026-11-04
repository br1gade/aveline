import { redactText, redactUrl } from '../src/lib/capability-links/redact.ts';

const UNREADABLE = '[unreadable]';

/**
 * What the production server may say about a request (root CLAUDE.md §3). A guest's, a buyer's and
 * a vendor's addresses are working keys, so `react-router-serve`, which logs every address, could
 * not be used (BACKEND_REQUESTS §4).
 */
const KNOWN_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

const LOCAL = 'http://local';
/** More encoding than this is no link anyone was sent, and goes unread. */
const MOST_DECODES = 4;

function fullyDecoded(path: string): string {
  let decoded = path;
  for (let count = 0; count < MOST_DECODES; count += 1) {
    const next = decodeURIComponent(decoded);
    if (next === decoded) return decoded;
    decoded = next;
  }
  throw new URIError('Encoded too many times');
}

/**
 * The path, whichever way it was written: decoded until it stops changing, its `.`, `..` and repeated
 * slashes resolved and a backslash read as a slash, which `URL` does, and lower-cased, as the router
 * matches whatever the case. Otherwise a token could pass the patterns in a shape they don't know. A
 * query goes whole: a bank's parameters and a `?token=` are nobody's business here.
 */
function normalizedPath(url: string): string {
  const [address = ''] = url.split('?', 1);
  const path = fullyDecoded(address.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')).split('?', 1)[0];
  const resolved = new URL(`${LOCAL}/${(path ?? '').replace(/^[/\\]+/, '')}`).pathname;
  return resolved.replace(/\/{2,}/g, '/').toLowerCase();
}

/** The path with its credential out; an address that can't be read is not logged at all. */
export function loggedPath(url: string): string {
  try {
    return redactUrl(normalizedPath(url));
  } catch {
    return UNREADABLE;
  }
}

/**
 * Whether to hand a request on at all. The router warns about a path it can't decode, and the adapter
 * prints an address it can't build, each with the whole path, token included, before any of our code
 * sees it. Neither is a page anyone can be sent to, so they end here with a 400.
 */
export function canReachRouter(url: string, host: string | undefined): boolean {
  return loggedPath(url) !== UNREADABLE && URL.canParse(`http://${host ?? 'localhost'}${url}`);
}

export interface RequestFacts {
  method: string;
  url: string;
  status: number;
  ms: number;
}

/** One line of JSON per request. */
export function requestLine({ method, url, status, ms }: RequestFacts): string {
  return JSON.stringify({
    method: KNOWN_METHODS.has(method) ? method : 'OTHER',
    path: loggedPath(url),
    status,
    ms,
  });
}

/** An error's text, which may quote the address it failed on. */
export function loggedError(error: unknown): string {
  return redactText(error instanceof Error ? (error.stack ?? error.message) : String(error));
}
