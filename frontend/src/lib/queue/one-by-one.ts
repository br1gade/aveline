/** What sending several requests one at a time came to. */
export interface OneByOne<T> {
  done: T[];
  /** The item refused and every one after it; nothing more was sent. */
  notDone: T[];
  /** The refusal that stopped it; `null` when every item went. */
  error: unknown;
}

/**
 * Runs one request per item, in order, and stops at the first refusal, so nothing is sent on a
 * state that has just changed. For the API's one-at-a-time writes where the intent is several
 * (FR-53, FR-118): the caller says who was done and who wasn't.
 */
export async function oneByOne<T>(
  items: readonly T[],
  run: (item: T) => Promise<unknown>,
): Promise<OneByOne<T>> {
  const done: T[] = [];
  for (const [index, item] of items.entries()) {
    try {
      await run(item);
      done.push(item);
    } catch (error) {
      return { done, notDone: items.slice(index), error };
    }
  }
  return { done, notDone: [], error: null };
}
