// Disposable Compose project only. Never adopt an existing application's volumes.
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { buildConfiguration, writeProfile, readProfile } from './ops/config.mjs';
import { applyRelease } from './ops/deploy.mjs';
import { context, compose, docker } from './ops/runtime.mjs';
import { localResourceName } from './local-ci/scope.mjs';
async function reservePort() { const server = createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port; }
const root = await mkdtemp(join(tmpdir(), 'aveline-compose-'));
const profilePath = join(root, 'profile');
const project = localResourceName(`aveline-compose-${process.pid}-${randomBytes(3).toString('hex')}`, 'c');
const images = { api: process.env.OPS_REHEARSAL_IMAGE ?? 'aveline-api:ops-test', backup: process.env.OPS_REHEARSAL_BACKUP_IMAGE ?? 'aveline-backup:ops-test' };
let ctx; let wasScopeAccepted = false; let didSucceed = false;
try {
  const config = buildConfiguration({ mode: 'local', project, apiPort: await reservePort(), mediaPort: await reservePort(), mailPort: await reservePort() });
  config.env.SMTP_PASSWORD = 'synthetic-$HOME-"-\\-password';
  await writeProfile(profilePath, config);
  ctx = context(await readProfile(profilePath), images);
  for (const args of [['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`], ['volume', 'ls', '-q', '--filter', `label=com.aveline.project=${project}`], ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]]) {
    assert.equal((await docker(ctx, args, 'verify disposable scope is new')).trim(), '');
  }
  wasScopeAccepted = true;
  await applyRelease(await readProfile(profilePath), images, project, { isPrebuilt: true });
  const profile = await readProfile(profilePath); ctx = context(profile, images);
  const report = await fetch(`http://127.0.0.1:${profile.env.LOCAL_API_PORT}/api/v1/health/ready`);
  assert.equal(report.status, 200);
  const id = (await compose(ctx, ['ps', '-q', 'api'], 'inspect API')).trim();
  const [container] = JSON.parse(await docker(ctx, ['inspect', id], 'inspect runtime configuration'));
  assert.ok(container.Config.Env.includes(`SMTP_PASSWORD=${config.env.SMTP_PASSWORD}`), 'dotenv must preserve literal special characters');
  assert.equal((await fetch(`http://127.0.0.1:${profile.env.LOCAL_API_PORT}/docs`)).status, 404);
  await applyRelease(profile, images, project, { isPrebuilt: true });
  const state = JSON.parse(await readFile(join(profilePath, 'release-state.json'), 'utf8'));
  assert.equal(state.api, images.api); assert.equal(state.previous.api, images.api);
  const sets = await compose(ctx, ['run', '--rm', '--no-deps', 'backup', 'sh', '-c', 'find /backups -name postgres.dump'], 'inspect local recovery sets');
  assert.ok(sets.includes('postgres.dump'));
  await compose(ctx, ['down', '--volumes', '--remove-orphans'], 'check normal teardown preserves independent journal');
  await docker(ctx, ['volume', 'inspect', `${project}-privacy-journal`], 'verify journal survives Compose volume teardown');
  didSucceed = true;
  console.log('Compose rehearsal passed: private config, real stores/Garage, migrations, seed, all worker heartbeats, gateway, redeploy and local backup.');
} catch { console.error(`Compose rehearsal failed; private diagnostic profile retained at ${profilePath}.`); process.exitCode = 1; }
finally {
  ctx ??= context(await readProfile(profilePath), images);
  if (wasScopeAccepted) await compose(ctx, ['down', '--volumes', '--remove-orphans'], 'remove disposable project').catch(() => undefined);
  if (wasScopeAccepted) await docker(ctx, ['volume', 'rm', `${project}-privacy-journal`], 'remove disposable independent journal').catch(() => undefined);
  if (didSucceed) await rm(root, { recursive: true, force: true });
}
