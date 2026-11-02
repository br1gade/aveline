import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startSeatingWorker } from '../../fixtures/seating-worker.fixture';
import { disconnectTestDatabase, resetTestDatabase } from '../../setup/test-database';

/** backend/docs/SEATING_WORKER.md "Run and monitor": the heartbeat and the healthcheck that reads it. */
describe('Seating worker heartbeat (integration)', () => {
  let root: string;
  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(join(tmpdir(), 'aveline-seating-health-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));
  afterAll(() => disconnectTestDatabase());

  /** Exit status of the container healthcheck pointed at `path`. */
  const healthcheck = (path: string) => spawnSync(process.execPath, ['scripts/check-seating-worker.mjs'], {
    cwd: process.cwd(), env: { ...process.env, SEATING_WORKER_HEARTBEAT_PATH: path },
  }).status;

  const waitForFile = async (path: string) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const content = await readFile(path, 'utf8').catch(() => null);
      if (content) return content;
      await delay(50);
    }
    throw new Error('Seating worker wrote no heartbeat');
  };

  it('writes an owner-only heartbeat of the current time after polling an empty queue, which the healthcheck accepts', async () => {
    const path = join(root, 'heartbeat');
    const startedAt = Date.now();
    const worker = startSeatingWorker(path);
    try {
      const content = await waitForFile(path);

      expect(Number(content)).toBeGreaterThanOrEqual(startedAt);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(healthcheck(path)).toBe(0);
    } finally {
      worker.child.kill('SIGTERM');
      await worker.exited;
    }
  });

  it.each([
    ['missing', null],
    ['not a number', 'abc'],
    ['older than 120 seconds', () => String(Date.now() - 121_000)],
  ])('reports the worker unhealthy when its heartbeat is %s', async (_label, content) => {
    const path = join(root, 'heartbeat');
    if (content !== null) await writeFile(path, typeof content === 'function' ? content() : content);

    expect(healthcheck(path)).toBe(1);
  });

  it('reports the worker healthy when its heartbeat is just inside 120 seconds', async () => {
    const path = join(root, 'heartbeat');
    await writeFile(path, String(Date.now() - 110_000));

    expect(healthcheck(path)).toBe(0);
  });
});
