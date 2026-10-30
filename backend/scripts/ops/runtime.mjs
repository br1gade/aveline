import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, readFile, unlink, open } from 'node:fs/promises';
const execute = promisify(execFile);
export const backend = fileURLToPath(new URL('../../', import.meta.url));
export function context(profile, images, options = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(profile.env)) delete env[key];
  Object.assign(env, { COMPOSE_PROJECT_NAME: profile.settings.project, AVELINE_ENV_FILE: join(profile.directory, '.env'),
    AVELINE_GARAGE_CONFIG: join(profile.directory, 'garage.toml'), AVELINE_RUNTIME_ENV_FILE: join(profile.directory, '.runtime.env'), API_IMAGE: images.api, BACKUP_IMAGE: images.backup,
    AVELINE_DEPLOYMENT_MODE: profile.settings.mode, BACKUP_STATE_DIR: join(profile.directory, 'backup-state') });
  const compose = ['compose', '--project-name', profile.settings.project, '--env-file', env.AVELINE_ENV_FILE, '-f', join(backend, 'docker-compose.prod.yml'), '-f', join(backend, 'docker-compose.ops.yml')];
  if (profile.settings.mode === 'local') compose.push('-f', join(backend, 'docker-compose.local.yml'));
  return { profile, images, env, compose, isPrebuilt: options.isPrebuilt === true };
}
export async function run(command, args, options = {}) {
  try { return (await execute(command, args, { cwd: backend, timeout: options.timeout ?? 180000, maxBuffer: 8 * 1024 * 1024, env: options.env ?? process.env })).stdout; }
  catch (error) { if (options.profile) await record(options.profile, 'last-error.json', { stage: options.stage, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }); throw new Error(`Operation failed: ${options.stage ?? command}. Inspect protected host logs; command output was withheld.`); }
}
export function docker(ctx, args, stage, timeout) { return run('docker', args, { env: ctx.env, stage, timeout, profile: ctx.profile }); }
export function compose(ctx, args, stage, timeout) { return docker(ctx, [...ctx.compose, ...args], stage, timeout); }
export async function withDeploymentLock(ctx, callback) {
  const lock = join(ctx.profile.directory, 'deployment.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch { throw new Error('Deployment lock exists. Check the recorded process before removing a stale lock.'); }
  try {
    if (ctx.profile.environmentHash && createHash('sha256').update(await readFile(join(ctx.profile.directory, '.env'))).digest('hex') !== ctx.profile.environmentHash) throw new Error('Configuration changed; reload before continuing');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await handle.sync(); return await callback(); }
  finally { await handle.close(); await unlink(lock); }
}
export async function readState(profile) {
  try { return JSON.parse(await readFile(join(profile.directory, 'release-state.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Invalid release-state file'); }
}
export async function record(profile, name, value) {
  const temporary = join(profile.directory, `.${name}-${randomUUID()}`);
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const { rename } = await import('node:fs/promises');
  await rename(temporary, join(profile.directory, name));
}
