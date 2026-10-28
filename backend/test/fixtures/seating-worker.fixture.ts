import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { TEST_DATABASE_URL } from '../setup/test-database';
import { PrismaClient } from '@prisma/client';

export function startSeatingWorker(heartbeatPath: string) {
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/seating-worker.ts'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL,
      TS_NODE_PROJECT: 'tsconfig.build.json', ANALYTICS_ENABLED: 'false', SEATING_WORKER_HEARTBEAT_PATH: heartbeatPath },
  });
  const exited = new Promise<number | null>((resolve) => { child.once('exit', resolve); });
  return { child, exited };
}
export async function waitForSeatingState(prisma: PrismaClient, id: string, status: string, attempts = 1): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const job = await prisma.seatingJob.findUniqueOrThrow({ where: { id } });
    if (job.status === status && job.attempts >= attempts) return;
    await delay(50);
  }
  throw new Error(`Seating worker did not reach ${status}`);
}
