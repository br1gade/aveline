import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { validateManifest } from './plan.mjs';
const execute = promisify(execFile);
const safePath = (value) => /^\/[a-zA-Z0-9_./-]+$/.test(value ?? '') && !value.split('/').includes('..');
export function remoteSettings(env) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(env.DEPLOY_HOST ?? '') || !/^[a-z_][a-z0-9_-]*$/.test(env.DEPLOY_USER ?? '')) throw new Error('Invalid SSH host/user');
  if (!safePath(env.DEPLOY_ROOT) || !safePath(env.DEPLOY_PROFILE) || !/^[a-z][a-z0-9-]{2,31}$/.test(env.DEPLOY_PROJECT ?? '') || env.CONFIRM_PROJECT !== env.DEPLOY_PROJECT) throw new Error('Invalid deployment paths or maintenance confirmation');
  if (!env.DEPLOY_KNOWN_HOSTS?.trim() || !env.DEPLOY_SSH_KEY?.includes('PRIVATE KEY')) throw new Error('Pinned SSH host keys and a deployment key are required');
  return { host: `${env.DEPLOY_USER}@${env.DEPLOY_HOST}`, root: env.DEPLOY_ROOT, profile: env.DEPLOY_PROFILE, project: env.DEPLOY_PROJECT };
}
async function deploy() {
  const settings = remoteSettings(process.env);
  const manifest = JSON.parse(await readFile(process.env.RELEASE_MANIFEST, 'utf8'));
  validateManifest(manifest, manifest);
  const directory = await mkdtemp(join(tmpdir(), 'aveline-ssh-'));
  try {
    await writeFile(join(directory, 'key'), process.env.DEPLOY_SSH_KEY + '\n', { mode: 0o600 });
    await writeFile(join(directory, 'known_hosts'), process.env.DEPLOY_KNOWN_HOSTS + '\n', { mode: 0o600 });
    const flags = ['-i', join(directory, 'key'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${join(directory, 'known_hosts')}`, '-o', 'ConnectTimeout=15'];
    const release = `${settings.root}/releases/${manifest.commit}-${Date.now()}`;
    await execute('ssh', [...flags, settings.host, `umask 077; mkdir -p '${settings.root}/releases'; mkdir '${release}'`]);
    await execute('scp', [...flags, process.env.RELEASE_ARCHIVE, `${settings.host}:${release}/source.tar.gz`]);
    const script = `set -eu\ncd '${release}'\ntar --no-same-owner --no-same-permissions -xzf source.tar.gz\ncd backend\nnode scripts/ops.mjs apply --directory '${settings.profile}' --image '${manifest.api}' --backup-image '${manifest.backup}' --confirm '${settings.project}'\nln -s '${release}' '${settings.root}/.current-${manifest.commit}'\nmv -Tf '${settings.root}/.current-${manifest.commit}' '${settings.root}/current'\n`;
    await new Promise((resolve, reject) => {
      const child = spawn('ssh', [...flags, settings.host, 'sh -s'], { stdio: ['pipe', 'inherit', 'inherit'] });
      child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Remote deployment failed'))); child.stdin.end(script);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] === new URL(import.meta.url).pathname) void deploy().catch(() => { console.error('Verified SSH deployment failed; review host state. Credentials withheld.'); process.exitCode = 1; });
