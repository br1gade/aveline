/**
 * The bank's payment page, from checkout's answer, or `null` when it is not one to follow: only an
 * https address, or a page of this client (the local `FAKE` gateway returns straight to
 * `/tickets/return`). Anything else, a `javascript:` address above all, stays on the page.
 */
export function bankAddress(address: string | null | undefined, origin: string): string | null {
  if (!address) return null;
  try {
    const url = new URL(address, origin);
    const isOwnPage = url.origin === new URL(origin).origin;
    return url.protocol === 'https:' || isOwnPage ? url.toString() : null;
  } catch {
    return null;
  }
}
