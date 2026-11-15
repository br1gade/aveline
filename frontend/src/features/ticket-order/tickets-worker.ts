/**
 * The tickets page's own worker (design PD-202, `public/tickets-sw.js`), registered by the order
 * page and told what to keep: the page's bare frame and the hashed files this page already loaded.
 * A buyer reaches `/tickets` from checkout without loading a document there, so the worker never
 * sees that page's own requests; told, it keeps them all the same, and a reload with no signal
 * opens the page. Browser only: called from an effect.
 */
const SCRIPT = '/tickets-sw.js';
const SCOPE = '/tickets';
const FRAME = '/tickets';
const ASSETS = '/assets/';

function parsed(address: string, origin: string): URL | null {
  try {
    return new URL(address, origin);
  } catch {
    return null;
  }
}

/** The same-origin hashed files among `addresses`, without a query: never one that names a token. */
export function keptFiles(addresses: readonly string[], origin: string): string[] {
  const files = new Set<string>();
  for (const address of addresses) {
    const url = parsed(address, origin);
    if (url?.origin === origin && url.search === '' && url.pathname.startsWith(ASSETS)) {
      files.add(url.pathname);
    }
  }
  return [...files];
}

function activated(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  const pending = registration.installing ?? registration.waiting;
  if (registration.active) return Promise.resolve(registration.active);
  if (!pending) return Promise.reject(new Error('No worker to wait for'));
  return new Promise((resolve) => {
    pending.addEventListener('statechange', () => {
      if (pending.state === 'activated') resolve(pending);
    });
  });
}

function loadedAddresses(): string[] {
  const loaded = performance.getEntriesByType('resource').map(({ name }) => name);
  const linked = Array.from(
    document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[href]'),
    (element) => ('src' in element ? element.src : element.href),
  );
  return [...loaded, ...linked];
}

/** Registers the worker and has it keep this page. Refused or absent, the page works as before. */
export async function keepTicketsOffline(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register(SCRIPT, { scope: SCOPE });
    const worker = await activated(registration);
    worker.postMessage({ keep: [FRAME, ...keptFiles(loadedAddresses(), location.origin)] });
  } catch {
    // No worker: a reload with no signal shows the browser's own page, as before PD-202.
  }
}
