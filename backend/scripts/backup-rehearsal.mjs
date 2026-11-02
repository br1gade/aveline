import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { localResourceName } from './local-ci/scope.mjs';

const execute = promisify(execFile);
const docker = (...args) => execute('docker', args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
const scope = localResourceName(`aveline-recovery-${process.pid}`, 'b');
const root = await mkdtemp(join(tmpdir(), 'aveline-recovery-'));
const apiImage = process.env.PILOT_REHEARSAL_IMAGE ?? 'aveline-api:pilot-j-local';
const output = join(process.cwd(), 'test-results', 'backup', scope);
await mkdir(output, { recursive: true, mode: 0o700 });
const report = { scope: 'disposable-local-backend', startedAt: new Date().toISOString(), isOffHost: false, isPassed: false };
let captureStarted;
let restoreStarted;
const backupImage = process.env.BACKUP_REHEARSAL_IMAGE ?? 'aveline-backup:pilot-readiness';
const scripts = new URL('./', import.meta.url).pathname;
const password = randomBytes(24).toString('hex');
const resticPassword = randomBytes(32).toString('base64');
const containers = [];
let wasNetworkCreated = false;
let stage = 'create disposable stores';
async function start(name, image, args) {
  const id = `${scope}-${name}`;
  containers.push(id);
  await docker('run', '-d', '--name', id, '--network', scope, ...args, image);
  return id;
}
const databaseUrl = (name) => `postgresql://aveline:${password}@${scope}-${name}:5432/aveline_recovery_test?schema=public`;
async function ready(name, command) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { return await docker('exec', name, ...command); } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error('Disposable store did not become ready');
}
const sourceConfig = `metadata_dir="/var/lib/garage/meta"\ndata_dir="/var/lib/garage/data"\ndb_engine="sqlite"\nreplication_factor=1\nrpc_bind_addr="[::]:3901"\nrpc_public_addr="${scope}-garage:3901"\nrpc_secret="${randomBytes(32).toString('hex')}"\n[s3_api]\ns3_region="garage"\napi_bind_addr="[::]:3900"\n[s3_web]\nbind_addr="[::]:3902"\nroot_domain=".web.garage.localhost"\nindex="index.html"\n`;
try {
  for (const folder of ['data', 'meta', 'restored-data', 'restored-meta', 'backups', 'repository', 'config', 'recovery', 'state']) {
    await mkdir(join(root, folder));
  }
  await writeFile(join(root, 'config', 'garage.toml'), sourceConfig, { mode: 0o600 });
  await docker('network', 'create', scope);
  wasNetworkCreated = true;
  for (const name of ['postgres', 'restored-postgres']) {
    await start(name, 'postgres:16.15-alpine', ['-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_recovery_test']);
    await ready(`${scope}-${name}`, ['pg_isready', '-U', 'aveline']);
  }
  const garage = await start('garage', 'dxflrs/garage:v2.1.0', [
    '-v', `${root}/config/garage.toml:/etc/garage.toml:ro`, '-v', `${root}/data:/var/lib/garage/data`, '-v', `${root}/meta:/var/lib/garage/meta`,
  ]);
  await ready(garage, ['/garage', 'status']);
  const node = (await docker('exec', garage, '/garage', 'node', 'id')).stdout.trim().split('@')[0];
  await docker('exec', garage, '/garage', 'layout', 'assign', '-z', 'rehearsal', '-c', '1G', node);
  await docker('exec', garage, '/garage', 'layout', 'apply', '--version', '1');
  await docker('exec', garage, '/garage', 'bucket', 'create', 'rehearsal-media');
  await docker('exec', garage, '/garage', 'bucket', 'create', 'rehearsal-private');
  await docker('exec', garage, '/garage', 'key', 'create', 'rehearsal-key');
  await docker('exec', garage, '/garage', 'bucket', 'allow', '--read', '--write', '--owner', 'rehearsal-media', '--key', 'rehearsal-key');
  await docker('exec', garage, '/garage', 'bucket', 'allow', '--read', '--write', '--owner', 'rehearsal-private', '--key', 'rehearsal-key');
  const keyInfo = (await docker('exec', garage, '/garage', 'key', 'info', 'rehearsal-key', '--show-secret')).stdout;
  const accessKey = /Key ID:\s*(\S+)/.exec(keyInfo)[1];
  const secretKey = /Secret key:\s*(\S+)/.exec(keyInfo)[1];
  stage = 'migrate and seed domain/media references';
  await docker('run', '--rm', '--network', scope, '-e', `DATABASE_URL=${databaseUrl('postgres')}`, apiImage, 'npx', 'prisma', 'migrate', 'deploy');
  await runFixture('seed', 'postgres', garage, { accessKey, secretKey });
  captureStarted = performance.now();
  await docker('stop', garage);
  stage = 'capture stable database and Garage';
  const backupArgs = ['--rm', '--network', scope, '-v', `${scripts}:/scripts:ro`, '-v', `${root}/backups:/backups`, '-v', `${root}/data:/garage-data:ro`, '-v', `${root}/meta:/garage-meta:ro`, '-v', `${root}/config:/runtime-config:ro`, '-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_recovery_test', '-e', `POSTGRES_HOST=${scope}-postgres`, '-e', 'BACKUP_QUIESCED=true', '-e', 'BACKUP_RUN_ID=drill'];
  await docker('run', ...backupArgs, backupImage, '/bin/sh', '/scripts/backup.sh');
  report.captureMs = performance.now() - captureStarted;
  stage = 'initialize and verify encrypted rehearsal repository';
  const repositoryArgs = ['--rm', '-v', `${scripts}:/scripts:ro`, '-v', `${root}/backups:/backups`, '-v', `${root}/repository:/repository`, '-v', `${root}/recovery:/recovery`, '-e', 'NODE_ENV=test', '-e', 'BACKUP_ALLOW_LOCAL_REPOSITORY=true', '-e', 'RESTIC_REPOSITORY=/repository', '-e', `RESTIC_PASSWORD=${resticPassword}`];
  await docker('run', ...repositoryArgs, backupImage, 'restic', 'init');
  stage = 'upload and read back encrypted rehearsal repository';
  await docker('run', ...repositoryArgs, backupImage, '/bin/sh', '/scripts/backup-upload.sh', 'drill');
  await assert.rejects(readFile(join(root, 'backups', 'offhost-success.json')), /ENOENT/);
  stage = 'download encrypted recovery set';
  restoreStarted = performance.now();
  await docker('run', ...repositoryArgs, backupImage, '/bin/sh', '/scripts/fetch-recovery.sh', 'drill', '/recovery/download');
  const restored = join(root, 'recovery', 'download', 'backups', 'drill');
  stage = 'restore paired database and media';
  await docker('run', '--rm', '--network', scope, '-v', `${scripts}:/scripts:ro`, '-v', `${restored}:/recovery-set:ro`, '-v', `${root}/restored-data:/garage-data`, '-v', `${root}/restored-meta:/garage-meta`, '-e', 'NODE_ENV=test', '-e', 'RESTORE_DISPOSABLE=true', '-e', 'RESTORE_QUIESCED=true', '-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_recovery_test', '-e', `POSTGRES_HOST=${scope}-restored-postgres`, backupImage, '/bin/sh', '/scripts/restore-recovery.sh', '/recovery-set');
  await writeFile(join(root, 'config', 'restored.toml'), sourceConfig.replace(`${scope}-garage:3901`, `${scope}-restored-garage:3901`), { mode: 0o600 });
  const restoredGarage = await start('restored-garage', 'dxflrs/garage:v2.1.0', ['-v', `${root}/config/restored.toml:/etc/garage.toml:ro`, '-v', `${root}/restored-data:/var/lib/garage/data`, '-v', `${root}/restored-meta:/var/lib/garage/meta`]);
  await ready(restoredGarage, ['/garage', 'status']);
  stage = 'verify restored guest credential and object bytes';
  await runFixture('verify', 'restored-postgres', restoredGarage, { accessKey, secretKey });
  report.recoveryFromRepositoryMs = performance.now() - restoreStarted;
  report.inventory = JSON.parse(await readFile(join(root, 'state', 'verified.json'), 'utf8'));
  report.isPassed = true;
  console.log('Recovery drill passed: 400-person domain, 21 snapshots, private gallery and public originals/variants restored and authorized.');
  console.log('Repository was isolated on this machine; a real off-host destination remains to be configured and verified.');
} catch (error) {
  console.error(`Recovery drill failed at: ${stage}. Temporary secrets and child command arguments are withheld.`);
  const detail = /Recovery fixture invariant failed \([A-Za-z0-9_, -]+\)/.exec(String(error.stderr ?? ''))?.[0];
  if (detail) console.error(detail);
  report.failureStage = stage;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`Sanitized recovery evidence: ${join(output, 'report.json')}`);
  await Promise.all(containers.map((name) => docker('rm', '-f', '-v', name).catch(() => undefined)));
  if (wasNetworkCreated) await docker('network', 'rm', scope);
  // Capture/restore writes are root-owned and private. Give only this caller
  // ownership of this drill's generated directory before deleting it.
  await docker('run', '--rm', '-v', `${root}:/work`, backupImage, 'chown', '-R', `${process.getuid()}:${process.getgid()}`, '/work');
  await rm(root, { recursive: true, force: true });
}

async function runFixture(action, database, garage, credentials) {
  await docker('run', '--rm', '--user', '0:0', '--network', scope, '-v', `${scripts}:/app/scripts:ro`, '-v', `${root}/state:/state`,
    '-e', 'RECOVERY_STATE_ROOT=/state', '-e', `DATABASE_URL=${databaseUrl(database)}`, '-e', `ENDPOINT=http://${garage}:3900`,
    '-e', `ACCESS_KEY=${credentials.accessKey}`, '-e', `SECRET_KEY=${credentials.secretKey}`, apiImage, 'node', 'scripts/backup-fixture.mjs', action);
}
