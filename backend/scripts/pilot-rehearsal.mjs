import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { localResourceName } from './local-ci/scope.mjs';

const execute = promisify(execFile);
const docker = (...args) => execute('docker', args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
const scope = localResourceName(`aveline-rehearsal-${process.pid}`, 'p');
const image = process.env.PILOT_REHEARSAL_IMAGE ?? 'aveline-api:pilot-readiness';
const directory = await mkdtemp(join(tmpdir(), 'aveline-rehearsal-'));
const containers = [];
let wasNetworkCreated = false;
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const password = randomBytes(24).toString('hex');
const environment = {
  NODE_ENV: 'production', PILOT_MODE: 'true',
  DATABASE_URL: `postgresql://aveline:${password}@${scope}-postgres:5432/aveline_rehearsal_test?schema=public`,
  REDIS_URL: `redis://${scope}-redis:6379`,
  MONGO_URL: `mongodb://aveline:${password}@${scope}-mongo:27017/aveline_rehearsal_test?authSource=admin`,
  SMTP_HOST: `${scope}-mailpit`, SMTP_PORT: '1025', MAIL_FROM: 'pilot@example.test',
  PUBLIC_APP_URL: `http://127.0.0.1:${port}`, CORS_ORIGINS: `http://127.0.0.1:${port}`,
  JWT_SECRET: randomBytes(48).toString('base64'), STORAGE_ROOT: '/app/storage',
};
const settings = Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
async function start(service, imageName, args = []) {
  const name = `${scope}-${service}`;
  containers.push(name);
  await docker('run', '-d', '--name', name, '--network', scope, ...args, imageName);
}
try {
  await docker('network', 'create', scope);
  wasNetworkCreated = true;
  await Promise.all([
    start('postgres', 'postgres:16.15-alpine', ['-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_rehearsal_test']),
    start('redis', 'redis:7.4.8-alpine'),
    start('mongo', 'mongo:7@sha256:1f995ad6fdb93244a1addab1b58f934a0bc2f5643c38e02f5e9d7f0c7d227a7b', ['-e', 'MONGO_INITDB_ROOT_USERNAME=aveline', '-e', `MONGO_INITDB_ROOT_PASSWORD=${password}`]),
    start('mailpit', 'axllent/mailpit:v1.21'),
  ]);
  let isDatabaseReady = false;
  for (let attempt = 0; attempt < 60 && !isDatabaseReady; attempt++) {
    try {
      await docker('exec', `${scope}-postgres`, 'pg_isready', '-U', 'aveline');
      isDatabaseReady = true;
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  assert.ok(isDatabaseReady, 'Disposable Postgres must become ready');
  await docker('run', '--rm', '--network', scope, ...settings, image, 'npx', 'prisma', 'migrate', 'deploy');
  await docker('run', '--rm', '--network', scope, ...settings, image, 'node', 'dist/seed-production.js');
  // Seeding twice proves that a redeploy does not require a reset.
  await docker('run', '--rm', '--network', scope, ...settings, image, 'node', 'dist/seed-production.js');
  await mkdir(join(directory, 'storage'));
  await docker('run', '--rm', '--user', '0:0', '-v', `${directory}/storage:/rehearsal`, image, 'chown', '1000:1000', '/rehearsal');
  await start('api', image, [...settings, '-p', `127.0.0.1:${port}:3000`, '-v', `${directory}/storage:/app/storage`]);
  let isApiReady = false;
  for (let attempt = 0; attempt < 100 && !isApiReady; attempt++) {
    try { isApiReady = (await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).ok; } catch {}
    if (!isApiReady) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(isApiReady, 'Disposable production API must become ready');
  const mongo = await docker('run', '--rm', '--network', scope, ...settings, image, 'node', 'scripts/mongo-smoke.mjs');
  console.log(mongo.stdout.trim());
  const result = await execute(process.execPath, [new URL('pilot-smoke.mjs', import.meta.url).pathname], {
    env: { ...process.env, PILOT_SMOKE_URL: `http://127.0.0.1:${port}`, PILOT_SMOKE_GUESTS: '400', PILOT_SMOKE_LOAD: 'true' }, timeout: 120000,
  });
  console.log(result.stdout.trim());
  const schema = await fetch(`http://127.0.0.1:${port}/docs`);
  assert.equal(schema.status, 404, 'Production must not publish Swagger');
  for (const dependency of ['mongo', 'redis']) {
    await docker('stop', `${scope}-${dependency}`);
    const degraded = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`);
    assert.equal(degraded.status, 200);
    const report = await degraded.json();
    assert.equal(report.status, 'degraded');
    assert.equal(report.optional[dependency].isUp, false);
    await docker('start', `${scope}-${dependency}`);
    let didRecover = false;
    for (let attempt = 0; attempt < 40 && !didRecover; attempt++) {
      const recovery = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`);
      didRecover = (await recovery.json()).optional[dependency].isUp;
      if (!didRecover) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(didRecover, `${dependency} must recover without an API restart`);
  }
  console.log('Disposable production image: migrations, idempotent seed, smoke journey and production guards passed.');
} catch (error) {
  // Child errors carry their command arguments, including temporary secrets.
  console.error(error instanceof assert.AssertionError ? error.message : 'Rehearsal failed; inspect the relevant stage without printing environment values.');
  process.exitCode = 1;
} finally {
  await Promise.all(containers.map((name) => docker('rm', '-f', '-v', name).catch(() => undefined)));
  if (wasNetworkCreated) await docker('network', 'rm', scope);
  await docker('run', '--rm', '--user', '0:0', '-v', `${directory}:/rehearsal`, image, 'chown', '-R', `${process.getuid()}:${process.getgid()}`, '/rehearsal').catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
