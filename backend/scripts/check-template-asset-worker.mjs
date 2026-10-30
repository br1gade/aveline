import { readFile } from 'node:fs/promises';
try {
  const last = Number(await readFile(process.env.TEMPLATE_ASSET_WORKER_HEARTBEAT_PATH ?? '/tmp/aveline-template-asset-worker-heartbeat', 'utf8'));
  if (!Number.isFinite(last) || last > Date.now() + 5000 || Date.now() - last > 120000) process.exitCode = 1;
} catch { process.exitCode = 1; }
