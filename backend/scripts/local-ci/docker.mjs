import { join } from 'node:path';
import { output, logged } from './process.mjs';
import { isLocalDockerEndpoint } from './policy.mjs';
export const WORKFLOW_LINTER = 'rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667';
export async function checkDocker(ctx, execute = output) {
  const endpoint = process.env.DOCKER_HOST ?? JSON.parse(await execute('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
  if (process.platform !== 'linux' || !isLocalDockerEndpoint(endpoint)) throw new Error('Local CI requires Linux and a local Docker Unix socket; remote Docker contexts are refused');
  await execute('docker', ['info', '--format', '{{.ServerVersion}}']);
  const version = await execute('docker', ['compose', 'version', '--short']);
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (!Number.isFinite(major) || major < 2 || (major === 2 && minor < 30)) throw new Error('Compose 2.30+ is required');
  for (const [kind, format] of [['ps', '{{.Names}}'], ['network', '{{.Name}}'], ['volume', '{{.Name}}']]) {
    const args = kind === 'ps' ? ['ps', '-a', '--format', format] : [kind, 'ls', '--format', format];
    if ((await execute('docker', args)).split('\n').some((name) => name.startsWith(`${ctx.scope}-`))) throw new Error('Disposable namespace already exists');
  }
  for (const image of [ctx.image, ctx.env.CI_API_IMAGE, ctx.env.CI_BACKUP_IMAGE]) if (await execute('docker', ['image', 'ls', '-q', image])) throw new Error('Disposable image tag already exists');
  ctx.wasScopeAccepted = true;
}
export function composeArgs(ctx, layer, args) {
  return ['compose', '--project-name', `${ctx.scope}-${layer}`, '-f', join(ctx.source, 'backend/docker-compose.ci.yml'), ...args];
}
export async function runLayer(ctx, layer) {
  const log = join(ctx.evidence, `${layer}.log`);
  const options = { cwd: ctx.source, env: ctx.env, log, stage: layer };
  await logged('docker', composeArgs(ctx, layer, ['up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis', 'mongo', 'mailpit']), options);
  try {
    await logged('docker', composeArgs(ctx, layer, ['run', '--rm', '--no-deps', '--name', `${ctx.scope}-${layer}-runner`, 'runner', 'node', 'scripts/ci-job.mjs', layer]), options);
  } finally {
    await logged('docker', composeArgs(ctx, layer, ['down', '--volumes', '--remove-orphans']), { ...options, stage: `${layer} cleanup`, timeout: 120000 });
  }
}
export async function cleanup(ctx, execute = output) {
  if (!ctx.wasScopeAccepted) return;
  const errors = [];
  const attempt = async (args) => { try { return await execute('docker', args); } catch (error) { errors.push(error); return ''; } };
  for (const kind of ['container', 'network', 'volume']) {
    const format = kind === 'container' ? '{{.Names}}' : '{{.Name}}';
    const args = kind === 'container' ? ['ps', '-a', '--format', format] : [kind, 'ls', '--format', format];
    const owned = (await attempt(args)).split('\n').filter((name) => name.startsWith(`${ctx.scope}-`));
    for (const name of owned) await attempt(kind === 'container' ? ['rm', '-f', '-v', name] : [kind, 'rm', name]);
  }
  for (const image of [ctx.image, ctx.env.CI_API_IMAGE, ctx.env.CI_BACKUP_IMAGE]) {
    if (await attempt(['image', 'ls', '-q', image])) await attempt(['image', 'rm', image]);
  }
  if (errors.length) throw new Error('Local CI cleanup was incomplete; inspect the run namespace recorded in summary.json');
}
