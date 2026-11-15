/**
 * The tickets page's own worker (design PD-202, audit F-22). It keeps two things, so that a buyer
 * who reloads `/tickets` with no signal still gets the page, which then shows the order as the tab
 * last read it:
 *
 * - the page's frame, from a navigation to exactly `/tickets`, with no query but `lang`. That frame
 *   holds no token: the server never sees one (PD-81). `/tickets/<token>`, `/tickets/return` and
 *   any other query are never kept, so no token reaches a cache's names or contents;
 * - the hashed scripts, styles and fonts under `/assets/` that the frame and this page name, which
 *   never change under one name; those of an earlier release are dropped once no longer named.
 *
 * Everything else, the API above all, goes to the network untouched. Registered with the scope
 * `/tickets` by the order page, which also names what to keep (`features/ticket-order/tickets-worker.ts`).
 */
const CACHE = 'aveline-tickets-v1';
const FRAME = '/tickets';
const ASSETS = '/assets/';

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

/** A navigation to the frame: `/tickets`, its language the only query it may carry. */
function isFrame(url) {
  return url.pathname === FRAME && [...url.searchParams.keys()].every((key) => key === 'lang');
}

/** The network first, kept under the frame's bare address; the kept frame when no answer comes. */
async function frame(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(FRAME, response.clone());
    return response;
  } catch (error) {
    const kept = await cache.match(FRAME);
    if (kept) return kept;
    throw error;
  }
}

/** A hashed file: what is kept, else the network, kept once it answers. */
async function asset(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** An address of this origin the worker may keep: the bare frame, or a hashed file. */
function keepable(address) {
  let url;
  try {
    url = new URL(address, self.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== self.location.origin || url.search !== '') return null;
  return url.pathname === FRAME || url.pathname.startsWith(ASSETS) ? url.pathname : null;
}

/**
 * The hashed files a kept page or stylesheet names: the frame's scripts and styles, which hydrate
 * it even when the page's own list of what it loaded ran out, and a sheet's fonts, which load only
 * once text needs them.
 */
async function namedBy(cache, path) {
  const isPage = path === FRAME;
  if (!isPage && !path.endsWith('.css')) return [];
  const kept = await cache.match(path);
  const text = kept ? await kept.text() : '';
  const pattern = isPage ? /["'](\/assets\/[^"'?#\s]+)["']/g : /url\(["']?([^"')?#]+)["']?\)/g;
  return [...text.matchAll(pattern)]
    .map(([, address]) => keepable(new URL(address, self.location.origin + path).href))
    .filter(Boolean);
}

/** Keeps one address and what it names, each once; one that fails is left for the next visit. */
async function keep(cache, path, kept) {
  if (kept.has(path)) return;
  kept.add(path);
  try {
    if (path === FRAME) {
      const response = await fetch(FRAME);
      if (response.ok) await cache.put(FRAME, response);
    } else if (!(await cache.match(path))) {
      await cache.add(path);
    }
  } catch {
    return;
  }
  await Promise.all((await namedBy(cache, path)).map((named) => keep(cache, named, kept)));
}

/** Files of an earlier release that this one no longer names. */
async function dropUnnamed(cache, kept) {
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(ASSETS) && !kept.has(pathname)) await cache.delete(request);
  }
}

/**
 * The order page names what it loaded (`features/ticket-order/tickets-worker.ts`): a buyer arrives
 * from checkout without loading a document here, so those requests never reach this worker.
 */
self.addEventListener('message', (event) => {
  if (event.origin !== self.location.origin) return;
  const asked = Array.isArray(event.data?.keep) ? event.data.keep : [];
  const paths = [...new Set(asked.map((address) => keepable(String(address))).filter(Boolean))];
  const kept = new Set();
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(paths.map((path) => keep(cache, path, kept)));
      await dropUnnamed(cache, kept);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && isFrame(url)) event.respondWith(frame(request));
  else if (url.pathname.startsWith(ASSETS) && url.search === '') event.respondWith(asset(request));
});
