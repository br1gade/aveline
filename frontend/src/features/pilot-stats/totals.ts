/**
 * A share of a whole, or none when the whole is nothing (docs/API.md: "show a dash when the
 * denominator is 0"). It can pass one: the door admits guests who never said yes.
 */
export function shareOf(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}
