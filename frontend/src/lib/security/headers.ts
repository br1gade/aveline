/**
 * Response headers for every page (setup proposal §5.11): a nonce-based Content Security Policy,
 * no MIME sniffing, and no framing, but for the one page the app frames itself (design PD-153).
 * Capability pages add their own referrer and cache rules in their route's `headers` export.
 */
export interface SecurityOptions {
  nonce: string;
  /** The development server injects scripts that a strict policy would block. */
  isProduction: boolean;
  mediaOrigin?: string | undefined;
  apiOrigin?: string | undefined;
  /** Who may frame the page: nobody, or the app itself for the designer's draft preview. */
  framing?: 'none' | 'self';
  /** Who may use the camera, which the door's scanner alone asks for: this origin, or nobody. */
  camera?: 'self' | 'none';
}

/**
 * The browser's features this document may use. It holds for the document's whole life, client
 * navigation included, so the camera closes only on a page that never goes on into the app.
 */
function permissionsPolicy(camera: 'self' | 'none'): string {
  return `camera=(${camera === 'self' ? 'self' : ''}), microphone=(), geolocation=()`;
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function originOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function contentSecurityPolicy(options: SecurityOptions): string {
  const media = originOf(options.mediaOrigin);
  const api = originOf(options.apiOrigin);
  const directives: Array<[string, Array<string | undefined>]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${options.nonce}'`]],
    // React's style attributes carry theme variables; inline styles cannot run code.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', media]],
    ['media-src', ["'self'", media]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", api]],
    ['frame-ancestors', [options.framing === 'self' ? "'self'" : "'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
  ];
  return directives
    .map(([name, sources]) => [name, ...sources.filter(Boolean)].join(' '))
    .join('; ');
}

export function applySecurityHeaders(headers: Headers, options: SecurityOptions): void {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', options.framing === 'self' ? 'SAMEORIGIN' : 'DENY');
  headers.set('Permissions-Policy', permissionsPolicy(options.camera ?? 'self'));
  if (options.isProduction) {
    headers.set('Content-Security-Policy', contentSecurityPolicy(options));
  }
}

/**
 * For any page whose URL carries a capability token: a personal invitation, later a ticket or a
 * brief. The URL is the credential (root CLAUDE.md §3). entry.server.tsx applies these by path, so
 * error pages and data requests get them too, not only the route that set them.
 */
export function capabilityPageHeaders(): Record<string, string> {
  return {
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}

/**
 * For the generic invitation link: not a credential, so the guest's browser may keep it for a
 * minute, but still kept out of search engines and referrers (design spec §12). Never in a shared
 * cache: each page carries its own script nonce, and one served to many visitors would let anyone
 * who read it run a script on another's page.
 */
export function publicInvitationHeaders(): Record<string, string> {
  return {
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, max-age=60',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}

/**
 * A public event's announcement (docs/API.md §5). Its robots rule is the response's own
 * `metadata.robots`, in a meta tag, verbatim, so no header here may contradict it. The visitor's
 * browser may keep it for a minute; never a shared cache, for the nonce's sake.
 */
export function publicEventHeaders(): Record<string, string> {
  return { 'Cache-Control': 'private, max-age=60' };
}

/**
 * Browsing public events. Its language comes from a cookie or the browser, not the address, so the
 * browser's copy must be told apart by them, or `/events` comes back in the last language.
 */
export function publicListingHeaders(): Record<string, string> {
  return { ...publicEventHeaders(), Vary: 'Cookie, Accept-Language' };
}

/**
 * Checkout holds what the buyer typed about other people, so no cache keeps it, and it is no page
 * for search engines.
 */
export function checkoutHeaders(): Record<string, string> {
  return {
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}
