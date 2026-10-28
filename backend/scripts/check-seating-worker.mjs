import { readFile } from 'node:fs/promises';
try {
  const last = Number(await readFile(process.env.SEATING_WORKER_HEARTBEAT_PATH ?? '/tmp/aveline-seating-worker-heartbeat', 'utf8'));
  if (!Number.isFinite(last) || Date.now() - last > 120_000) process.exitCode = 1;
} catch { process.exitCode = 1; }
