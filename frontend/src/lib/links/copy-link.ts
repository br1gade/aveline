import { readPublicEnv } from '@/config/env';

function isLoopback(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/**
 * Whether a link on `origin`, copied from the page at `page`, can open for someone else. A build
 * without its public origin falls back to localhost (`config/env.ts`), and a link to it, sent from
 * a real address, would reach its holder dead while the credential sat in their messages. Nor is
 * an `http` link sent from an `https` page, which would carry the credential unencrypted.
 */
export function isSendableOrigin(origin: string, page: string): boolean {
  const target = new URL(origin);
  const here = new URL(page);
  if (isLoopback(target) && !isLoopback(here)) return false;
  return target.protocol === 'https:' || here.protocol === 'http:';
}

export type CopyOutcome = 'copied' | 'refused' | 'unsendable';

/**
 * Hands a capability link to the clipboard and nowhere else: built on this client's public origin
 * only when the host presses Copy, never rendered, stored or logged (design PD-122, PD-213). The
 * browser may refuse the clipboard.
 */
export async function copyCapabilityLink(linkOn: (origin: string) => string): Promise<CopyOutcome> {
  const origin = readPublicEnv().VITE_PUBLIC_ORIGIN;
  if (!isSendableOrigin(origin, window.location.href)) return 'unsendable';
  try {
    await navigator.clipboard.writeText(linkOn(origin));
    return 'copied';
  } catch {
    return 'refused';
  }
}
