/** Leaves for the bank's own page, where the buyer pays (docs/PAYMENTS.md §1). A seam for tests. */
export function leaveForBank(address: string): void {
  window.location.assign(address);
}
