/** A value the backend sent, if it is one this page has words for; otherwise the fallback. */
export function known<T extends string>(list: readonly T[], value: string, fallback: T): T {
  return (list as readonly string[]).includes(value) ? (value as T) : fallback;
}
