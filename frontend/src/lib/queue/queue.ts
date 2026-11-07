/**
 * Runs at most `limit` tasks at once, the others in the order they came. The private pictures use
 * it, so a page of thumbnails does not send forty requests at the same moment.
 */
export interface Queue {
  /** Runs the task when a place is free; never starts it once `signal` has aborted. */
  run: <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
}

export function abortError(): Error {
  return new DOMException('The task was no longer wanted', 'AbortError');
}

export function createQueue(limit: number): Queue {
  let running = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    running -= 1;
    waiting.shift()?.();
  };
  const place = () =>
    new Promise<void>((resolve) => {
      if (running < limit) {
        running += 1;
        resolve();
        return;
      }
      waiting.push(() => {
        running += 1;
        resolve();
      });
    });

  return {
    async run(task, signal) {
      await place();
      if (signal?.aborted) {
        release();
        throw abortError();
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
