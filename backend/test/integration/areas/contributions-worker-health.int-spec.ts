import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/check-private-media-worker.mjs');

/** The container health check for the private media worker: exit code 0 is healthy. */
describe('Private media worker health check (integration coverage)', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'aveline-media-heartbeat-')); });
  afterAll(() => rm(root, { recursive: true, force: true }));

  const check = (heartbeatPath: string) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      stdio: 'ignore', env: { ...process.env, PRIVATE_MEDIA_WORKER_HEARTBEAT_PATH: heartbeatPath },
    });
    child.once('error', reject); child.once('exit', resolve);
  });
  let written = 0;
  const heartbeat = async (content: string) => {
    written += 1;
    const path = join(root, `heartbeat-${written}`);
    await writeFile(path, content);
    return path;
  };

  it('is healthy with a fresh heartbeat', async () => {
    expect(await check(await heartbeat(String(Date.now())))).toBe(0);
  });
  it('stays healthy with a heartbeat inside the 120-second window', async () => {
    expect(await check(await heartbeat(String(Date.now() - 100_000)))).toBe(0);
  });
  it('is unhealthy when the heartbeat is older than 120 seconds', async () => {
    expect(await check(await heartbeat(String(Date.now() - 121_000)))).toBe(1);
  });
  it('is unhealthy when no heartbeat was ever written', async () => {
    expect(await check(join(root, 'missing'))).toBe(1);
  });
  it('is unhealthy when the heartbeat is not a timestamp', async () => {
    expect(await check(await heartbeat('not-a-number'))).toBe(1);
  });
});
