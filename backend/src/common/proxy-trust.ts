/**
 * How many reverse proxies sit in front of the app.
 *
 * This decides whether the rate limiter works. Behind a proxy every request
 * arrives from the proxy's own address, so without trusting the forwarded
 * header the limiter sees one client and its per-client limit becomes a global
 * one — a hundred requests a minute for the entire internet, which is a denial
 * of service anyone can trigger by accident.
 *
 * It is a hop count rather than a boolean because trusting the whole
 * `X-Forwarded-For` chain is the opposite failure: a caller can prepend any
 * address they like and get a fresh bucket per request, evading the limiter
 * entirely. Counting from the right-hand end means only the hops we actually
 * run are believed.
 *
 * Pure and separate so the parsing is testable without booting the app, and so
 * the reasoning lives next to the decision rather than in a comment in
 * `main.ts`.
 */
export function proxyHopsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 0;

  // Plain digits only. `Number` accepts `1e3`, `0x4` and `Infinity`, none of
  // which anyone writes in a config file on purpose — and a value that was
  // meant to be something else should not be guessed at. Getting this wrong
  // permissively is the exploitable direction, so anything unexpected fails
  // closed.
  if (!/^\d+$/.test(raw.trim())) return 0;

  const hops = Number(raw.trim());

  // More hops than anyone runs is a typo, and treating `11` as eleven proxies
  // would trust a chain a caller controls.
  return Math.min(hops, MAX_PLAUSIBLE_HOPS);
}

/** A CDN in front of a load balancer in front of Caddy is three. */
const MAX_PLAUSIBLE_HOPS = 4;
