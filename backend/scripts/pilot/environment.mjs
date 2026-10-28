import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { poll } from './client.mjs';

const execute = promisify(execFile);
const DATABASE_CONNECTION_LIMIT = 20;
export async function createEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'aveline-j-'));
  const outputRoot = resolve('test-results/pilot', basename(root));
  await mkdir(join(outputRoot, 'artifacts'), { recursive: true, mode: 0o700 });
  const scope = `aveline-j-${process.pid}-${randomBytes(3).toString('hex')}`;
  const image = process.env.PILOT_REHEARSAL_IMAGE ?? 'aveline-api:pilot-j-local';
  const containers = [];
  const docker = (...args) => execute('docker', args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const port = await reservePort();
  const env = createSettings(scope, port);
  const password = new URL(env.DATABASE_URL).password;
  const settings = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  const mounts = ['-v', `${root}/state:/app/rehearsal-state`, '-v', `${root}/storage:/app/storage`, '-v', `${root}/private:/app/private-storage`, '-v', `${resolve('scripts/pilot')}:/app/scripts/pilot:ro`];
  const run = (...command) => docker('run', '--rm', '--network', scope, ...settings, ...mounts, image, ...command);
  async function start(service, imageName, args = [], command = []) {
    const name = `${scope}-${service}`; containers.push(name);
    await docker('run', '-d', '--name', name, '--network', scope, ...args, imageName, ...command);
  }
  async function setup() {
    await Promise.all(['state', 'storage', 'private', 'artifacts'].map((name) => mkdir(join(root, name))));
    await docker('run', '--rm', '--user', '0:0', '-v', `${root}:/rehearsal`, image, 'chown', '-R', '1000:1000', '/rehearsal');
    await docker('network', 'create', scope);
    await Promise.all([
      start('postgres', 'postgres:16.15-alpine', ['-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_rehearsal_test']),
      start('redis', 'redis:7.4.8-alpine'),
      start('mongo', 'mongo:7@sha256:1f995ad6fdb93244a1addab1b58f934a0bc2f5643c38e02f5e9d7f0c7d227a7b', ['-e', 'MONGO_INITDB_ROOT_USERNAME=aveline', '-e', `MONGO_INITDB_ROOT_PASSWORD=${password}`]),
      start('mailpit', 'axllent/mailpit:v1.21'),
    ]);
    await poll(() => docker('exec', `${scope}-postgres`, 'pg_isready', '-U', 'aveline').then(() => true).catch(() => false), Boolean, 'Postgres readiness');
    console.log('J: applying migrations');
    await run('npx', 'prisma', 'migrate', 'deploy');
    console.log('J: seeding twice');
    await run('node', 'dist/seed-production.js'); await run('node', 'dist/seed-production.js');
    await run('node', 'scripts/pilot/fixture.mjs', 'owner');
    await start('api', image, [...settings, ...mounts, '-p', `127.0.0.1:${port}:3000`], ['node', 'scripts/pilot/serve.mjs']);
    await poll(() => fetch(`${env.PUBLIC_APP_URL}/api/v1/health/ready`).then((r) => r.ok).catch(() => false), Boolean, 'API readiness');
    for (const name of ['export', 'seating', 'private-media']) {
      const health = ['--health-cmd', `node scripts/check-${name}-worker.mjs`, '--health-interval', '15s', '--health-timeout', '5s', '--health-start-period', '120s', '--health-retries', '3'];
      await start(`${name}-worker`, image, [...settings, ...mounts, ...health], ['node', `--max-old-space-size=${name === 'export' ? 384 : 256}`, name === 'seating' ? 'scripts/pilot/seating-worker.mjs' : `dist/${name}-worker.js`]);
    }
  }
  async function control(command) {
    const id = randomUUID();
    await writeFile(join(root, 'state/control.next'), JSON.stringify({ id, command }), { mode: 0o600 });
    await rename(join(root, 'state/control.next'), join(root, 'state/control.json'));
    return poll(() => read('control-result').catch(() => null), (value) => value?.id === id, `control ${command}`);
  }
  const read = async (name) => JSON.parse(await readFile(join(root, `state/${name}.json`), 'utf8'));
  const save = (name, value) => writeFile(join(root, `state/${name}.json`), JSON.stringify(value), { mode: 0o600 });
  const fixture = (action) => run('node', 'scripts/pilot/fixture.mjs', action);
  const holdWorkers = () => start('lease-lock', image, [...settings, ...mounts], ['node', 'scripts/pilot/fixture.mjs', 'hold-workers']);
  const privateStorageMode = (mode) => docker('run', '--rm', '--user', '0:0', '-v', `${root}/private:/private`, image, 'chmod', mode, '/private');
  const clearMemoryCache = () => control('cache-clear');
  const clearCache = async () => { await clearMemoryCache(); await docker('exec', `${scope}-redis`, 'redis-cli', 'FLUSHDB'); };
  const interrupt = (action, service) => docker(action, `${scope}-${service}`);
  async function failureSummary() {
    const logs = await docker('logs', '--tail', '150', `${scope}-api`);
    const entries = `${logs.stdout}\n${logs.stderr}`.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    return entries.filter((entry) => entry.level >= 50).map((entry) => {
      const text = JSON.stringify(entry);
      return { codes: [...new Set(text.match(/\bP\d{4}\b/g) ?? [])], postgresCodes: [...new Set(text.match(/\b(?:23503|23505|23514|40001|40P01|57014|57P01)\b/g) ?? [])],
        types: [...new Set(text.match(/\b(?:PrismaClient[A-Za-z]+Error|SeatingJobError|TypeError|ReferenceError)\b/g) ?? [])] };
    });
  }
  async function cleanup() {
    await Promise.all(containers.map((name) => docker('rm', '-f', name).catch(() => undefined)));
    await docker('network', 'rm', scope).catch(() => undefined);
    await docker('run', '--rm', '--user', '0:0', '-v', `${root}:/rehearsal`, image, 'chown', '-R', `${process.getuid()}:${process.getgid()}`, '/rehearsal').catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
  return { root, outputRoot, image, origin: env.PUBLIC_APP_URL, setup, cleanup, read, save, fixture, control, interrupt, clearCache, clearMemoryCache, holdWorkers, privateStorageMode, failureSummary,
    describe: async () => ({ resourcePrefix: scope, imageId: (await docker('image', 'inspect', image, '--format', '{{.Id}}')).stdout.trim(), postgresConnectionLimit: DATABASE_CONNECTION_LIMIT, apiProcesses: 1, workerProcesses: 3, workerHealth: 'production heartbeat scripts', storage: 'filesystem' }) };
}

async function reservePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

function createSettings(scope, port) {
  const password = randomBytes(24).toString('hex');
  const env = { NODE_ENV: 'production', PILOT_MODE: 'true',
    DATABASE_URL: `postgresql://aveline:${password}@${scope}-postgres:5432/aveline_rehearsal_test?schema=public&connection_limit=${DATABASE_CONNECTION_LIMIT}`,
    REDIS_URL: `redis://${scope}-redis:6379`,
    MONGO_URL: `mongodb://aveline:${password}@${scope}-mongo:27017/aveline_rehearsal_test?authSource=admin`,
    SMTP_HOST: `${scope}-mailpit`, SMTP_PORT: '1025', MAIL_FROM: 'pilot@example.test',
    PUBLIC_APP_URL: `http://127.0.0.1:${port}`, CORS_ORIGINS: `http://127.0.0.1:${port}`,
    JWT_SECRET: randomBytes(48).toString('base64'), STORAGE_ROOT: '/app/storage', PRIVATE_STORAGE_ROOT: '/app/private-storage',
    REHEARSAL_STATE_ROOT: '/app/rehearsal-state', REHEARSAL_TRACE_DB: String(process.env.PILOT_TRACE_DB === 'true'),
    REHEARSAL_METHOD_TIMINGS: String(process.env.PILOT_METHOD_TIMINGS === 'true') };
  return env;
}
