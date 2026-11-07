import { describe, expect, it } from 'vitest';

import { createQueue } from './queue';

/** A task that finishes when the test says so. */
function deferred() {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { done, finish };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a queue that runs a few tasks at a time', () => {
  it('starts no more than its limit, and the next as one finishes', async () => {
    const queue = createQueue(2);
    const started: number[] = [];
    const tasks = [deferred(), deferred(), deferred()];
    const runs = tasks.map((task, index) =>
      queue.run(async () => {
        started.push(index);
        await task.done;
        return index;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    tasks[0]?.finish();
    await expect(runs[0]).resolves.toBe(0);
    await tick();
    expect(started).toEqual([0, 1, 2]);
    tasks[1]?.finish();
    tasks[2]?.finish();
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
  });

  it('frees its place when a task fails', async () => {
    const queue = createQueue(1);
    const failing = queue.run(() => Promise.reject(new Error('no')));
    const next = queue.run(() => Promise.resolve('yes'));
    await expect(failing).rejects.toThrow('no');
    await expect(next).resolves.toBe('yes');
  });

  it('never starts a task whose caller stopped waiting', async () => {
    const queue = createQueue(1);
    const first = deferred();
    const running = queue.run(() => first.done);
    const stopped = new AbortController();
    let isStarted = false;
    const waiting = queue.run(async () => {
      isStarted = true;
      await Promise.resolve();
    }, stopped.signal);
    stopped.abort();
    first.finish();
    await running;
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(isStarted).toBe(false);
  });
});
