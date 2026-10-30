import { releasePlan, WRITERS } from './plan.mjs';
import { context, compose, docker, run, backend, readState, record, withDeploymentLock } from './runtime.mjs';
import { prepareJournal, bootstrapStorage } from './storage.mjs';
import { saveEnvironment } from './config.mjs';
import { join } from 'node:path';
export async function applyRelease(profile, images, confirmation, options = {}) {
  if (confirmation !== profile.settings.project) throw new Error('Apply requires --confirm with the exact project name');
  releasePlan(profile, images);
  const ctx = context(profile, images, options);
  return withDeploymentLock(ctx, () => deploy(ctx));
}
async function deploy(ctx) {
  const previous = await readState(ctx.profile);
  let stage = 'check';
  const step = async (name, callback) => {
    stage = name; console.log(`Deployment: ${name}`);
    await record(ctx.profile, 'deployment-attempt.json', { status: 'running', stage, images: ctx.images, startedAt: new Date().toISOString() });
    return callback();
  };
  try {
    await step('check', () => compose(ctx, ['config', '--quiet'], 'validate Compose'));
    await step('images', () => prepareImages(ctx));
    await step('prepare-journal-volume', () => prepareJournal(ctx));
    await step('dependencies', () => startDependencies(ctx));
    await step('storage-bootstrap', () => bootstrapStorage(ctx));
    const state = await step('candidate-preflight', () => compose(ctx, ['run', '--rm', '--no-deps', '--entrypoint', 'node', 'migrate', 'scripts/release-preflight.mjs'], 'candidate preflight'));
    if (!['EMPTY', 'POPULATED'].includes(state.trim())) throw new Error('Unexpected database preflight response');
    await step('backup-if-populated', async () => {
      if (state.trim() === 'POPULATED') await captureBackup(ctx, previous?.api ?? 'unrecorded');
    });
    await step('stop-writers', () => compose(ctx, ['stop', '--timeout', '60', ...WRITERS], 'stop every application writer'));
    await step('quiesced-preflight', () => compose(ctx, ['run', '--rm', '--no-deps', '--entrypoint', 'node', 'migrate', 'scripts/release-preflight.mjs'], 'quiesced candidate preflight'));
    await step('migrate', () => compose(ctx, ['run', '--rm', '--no-deps', 'migrate'], 'migrate candidate', 600000));
    await step('seed', () => compose(ctx, ['run', '--rm', '--no-deps', '--entrypoint', 'node', 'migrate', 'dist/seed-production.js'], 'seed reference data'));
    await step('start-and-check', () => compose(ctx, ['up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '180', ...WRITERS, 'caddy'], 'start release and verify health', 240000));
    await verifyPublicReadiness(ctx);
    Object.assign(ctx.profile.env, { API_IMAGE: ctx.images.api, BACKUP_IMAGE: ctx.images.backup });
    await saveEnvironment(ctx.profile);
    await record(ctx.profile, 'release-state.json', { ...ctx.images, previous: previous ? { api: previous.api, backup: previous.backup, deployedAt: previous.deployedAt } : null, deployedAt: new Date().toISOString() });
    await record(ctx.profile, 'deployment-attempt.json', { status: 'succeeded', images: ctx.images, completedAt: new Date().toISOString() });
  } catch (error) {
    await record(ctx.profile, 'deployment-attempt.json', { status: 'failed', stage, reason: error.message, images: ctx.images, schemaMayHaveChanged: ['migrate', 'seed', 'start-and-check'].includes(stage) });
    throw new Error(`Deployment stopped at ${stage}. Review deployment-attempt.json and protected logs. No database restore or old-image restart was attempted.`);
  }
}
async function prepareImages(ctx) {
  if (ctx.profile.settings.mode === 'local' && ctx.isPrebuilt) {
    for (const image of [ctx.images.api, ctx.images.backup]) await docker(ctx, ['image', 'inspect', image], 'check prebuilt image');
  } else if (ctx.profile.settings.mode === 'local') await compose(ctx, ['build', 'api', 'backup'], 'build local images', 1200000);
  else await compose(ctx, ['pull', 'migrate', 'backup'], 'pull immutable images', 600000);
}
async function startDependencies(ctx) {
  await compose(ctx, ['up', '-d', '--wait', '--wait-timeout', '90', 'postgres'], 'start PostgreSQL');
  const services = ['redis', 'mongo', 'garage', ...(ctx.profile.settings.mode === 'local' ? ['mailpit'] : [])];
  await compose(ctx, ['up', '-d', ...services], 'start optional services and storage');
}
export function captureBackup(ctx, release = 'unrecorded', resumeOnly = false) {
  const env = { ...ctx.env, BACKUP_RELEASE: release, BACKUP_LOCAL_ONLY: ctx.profile.settings.mode === 'local' ? 'true' : 'false' };
  if (!resumeOnly && ctx.profile.settings.mode === 'production' && (!ctx.profile.env.RESTIC_REPOSITORY || !ctx.profile.env.RESTIC_PASSWORD)) throw new Error('Populated production deployments require configured off-host backups');
  return run('bash', [join(backend, 'scripts/capture-backup.sh'), ...(resumeOnly ? ['--resume-only'] : [])], { env, timeout: 1800000, stage: 'coordinated backup', profile: ctx.profile });
}

async function verifyPublicReadiness(ctx) {
  const url = ctx.profile.settings.mode === 'local' ? `http://127.0.0.1:${ctx.profile.env.LOCAL_API_PORT}` : `https://${ctx.profile.env.API_DOMAIN}`;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(`${url}/api/v1/health/ready`, { signal: AbortSignal.timeout(5000) })).ok) return; } catch { /* TLS/bootstrap may still be completing. */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Public API readiness did not succeed');
}
