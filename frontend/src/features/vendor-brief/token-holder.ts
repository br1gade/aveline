/**
 * The brief's token, held for this page's life only (design PD-124). Unlike the buyer's order,
 * nothing comes back to the page without its link, so nothing is kept beyond memory: no storage,
 * no cookie, no history state. A reload asks the vendor to open the link again. Only set in the
 * browser, after hydration, so the server never shares one between requests.
 */
let held: string | null = null;

export function holdBrief(token: string): void {
  held = token;
}

export function heldBrief(): string | null {
  return held;
}

export function forgetBrief(): void {
  held = null;
}
