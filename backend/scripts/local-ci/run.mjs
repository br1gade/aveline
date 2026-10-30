import { mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { checkDocker, runLayer, cleanup, WORKFLOW_LINTER } from './docker.mjs';
import { output, logged, checkInterrupted } from './process.mjs';
import { saveJson, saveProof, withRunLock } from './state.mjs';
import { LAYERS } from './policy.mjs';
export async function runCi(root, target, jobs) {
  return withRunLock(root, target.tree, () => runSnapshot(root, target, jobs));
}
async function runSnapshot(root, target, jobs) {
  const scope = `av-ci-${randomBytes(6).toString('hex')}`;
  const evidence = join(root, '.local-ci/runs', `${target.commit.slice(0, 12)}-${scope}`);
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(tmpdir(), 'aveline-local-ci-'));
  const ctx = { root, scope, evidence, source: join(temporary, 'source'), image: `aveline-ci:${scope}`, wasScopeAccepted: false };
  ctx.env = { ...process.env, LOCAL_CI_IMAGE: ctx.image, AVELINE_LOCAL_CI_SCOPE: scope, CI_API_IMAGE: `aveline-api:${scope}`, CI_BACKUP_IMAGE: `aveline-backup:${scope}` };
  const summary = { version: 1, ...target, scope, startedAt: new Date().toISOString(), layers: [], status: 'running' };
  let failure;
  try { await executePipeline(ctx, summary, jobs); }
  catch (error) { failure = error; }
  try { await cleanup(ctx); } catch (error) { failure ??= error; }
  try { checkInterrupted(); } catch (error) { failure ??= error; }
  await rm(temporary, { recursive: true, force: true });
  Object.assign(summary, { status: failure ? 'failed' : 'passed', completedAt: new Date().toISOString(), error: failure?.message });
  await saveJson(join(evidence, 'summary.json'), summary);
  if (failure) throw failure;
  const layers = LAYERS.filter((layer) => summary.layers.includes(layer));
  if (layers.length !== LAYERS.length) throw new Error('Incomplete CI run; no success proof was written');
  const proof = { version: 1, tree: target.tree, commit: target.commit, completedAt: summary.completedAt, layers, imageId: summary.imageId, evidence };
  await saveProof(root, proof);
  console.log(`Local CI passed for ${target.commit.slice(0, 12)}. Evidence: ${evidence}`);
  return proof;
}
async function executePipeline(ctx, summary, jobs) {
  const stage = async (name, callback) => {
    checkInterrupted();
    console.log(`Local CI: ${name}`); summary.stage = name;
    await saveJson(join(ctx.evidence, 'summary.json'), summary);
    return callback();
  };
  await stage('preflight', () => checkDocker(ctx));
  await mkdir(ctx.source);
  const archive = join(ctx.source, '../source.tar');
  await output('git', ['archive', '--format=tar', '--output', archive, summary.commit], { cwd: ctx.root });
  await output('tar', ['--no-same-owner', '-xf', archive, '-C', ctx.source]);
  const buildLog = join(ctx.evidence, 'setup.log');
  const workflows = (await readdir(join(ctx.source, '.github/workflows'))).filter((name) => /\.ya?ml$/.test(name)).map((name) => `.github/workflows/${name}`);
  if (!workflows.length) throw new Error('No workflows found in committed snapshot');
  await stage('workflow lint', () => logged('docker', ['run', '--rm', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`, '--name', `${ctx.scope}-lint`, '-v', `${ctx.source}:/repo:ro`, '-w', '/repo', WORKFLOW_LINTER, '-color', ...workflows], { log: buildLog, stage: 'workflow lint' }));
  await stage('runner image', () => logged('docker', ['build', '-f', join(ctx.source, 'backend/Dockerfile.ci'), '-t', ctx.image, ctx.source], { log: buildLog, stage: 'runner image', timeout: 1200000 }));
  summary.imageId = await output('docker', ['image', 'inspect', '--format', '{{.Id}}', ctx.image]);
  await stage('quality', () => runLayer(ctx, 'quality')); summary.layers.push('quality');
  await stage('containers', () => logged(process.execPath, ['scripts/ci-job.mjs', 'containers'], { cwd: join(ctx.source, 'backend'), env: ctx.env, log: join(ctx.evidence, 'containers.log'), stage: 'container rehearsals' })); summary.layers.push('containers');
  await stage('integration and HTTP', () => runDatabaseLayers(ctx, jobs, summary));
}
async function runDatabaseLayers(ctx, jobs, summary) {
  const run = async (layer) => { console.log(`Local CI: starting ${layer}`); await runLayer(ctx, layer); summary.layers.push(layer); console.log(`Local CI: ${layer} passed`); };
  if (jobs === 1) { await run('integration'); await run('http'); return; }
  const results = await Promise.allSettled(['integration', 'http'].map(run));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}
