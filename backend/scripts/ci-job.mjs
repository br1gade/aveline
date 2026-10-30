// One command list for GitHub and the local gate. A failed command stops the job.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const npm = (script, ...args) => ({ command: 'npm', args: ['run', script, ...(args.length ? ['--', ...args] : [])] });
export function stepsFor(layer, env = process.env) {
  const api = env.CI_API_IMAGE ?? 'aveline-api:ci';
  const backup = env.CI_BACKUP_IMAGE ?? 'aveline-backup:pilot-readiness';
  const plans = {
    quality: ['lint', 'docs:check', 'openapi:check'].map((name) => npm(name)).concat([
      { command: 'npx', args: ['tsc', '--noEmit', '--incremental', 'false'] },
      ...['build', 'test:unit', 'test:pilot', 'test:backup', 'test:ops', 'test:ci'].map((name) => npm(name)),
    ]),
    integration: [npm('test:int', '--json', '--outputFile=/tmp/aveline-integration-results.json')],
    http: [npm('test:e2e', '--json', '--outputFile=/tmp/aveline-http-results.json')],
    containers: [
      { command: process.execPath, args: ['scripts/test-edge.mjs'] },
      { command: 'docker', args: ['build', '--tag', api, '.'] },
      { command: 'docker', args: ['build', '--file', 'Dockerfile.backup', '--tag', backup, '.'] },
      { command: process.execPath, args: ['scripts/ops-rehearsal.mjs'] },
      { command: process.execPath, args: ['scripts/pilot-rehearsal.mjs'] },
      { command: process.execPath, args: ['scripts/backup-rehearsal.mjs'] },
    ],
  };
  if (!Object.hasOwn(plans, layer)) throw new Error('Unknown CI job');
  return plans[layer];
}
export async function runSteps(steps, execute = executeStep) {
  for (const step of steps) await execute(step);
}
async function executeStep(step) {
  console.log(`CI: ${step.command} ${step.args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, { stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    const detach = () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    child.on('error', (error) => { detach(); reject(error); });
    child.on('exit', (code, signal) => { detach(); code === 0 ? resolve() : reject(new Error(`CI command failed (${signal ?? code})`)); });
  });
}
async function main() {
  const layer = process.argv[2];
  const api = process.env.CI_API_IMAGE ?? 'aveline-api:ci';
  const backup = process.env.CI_BACKUP_IMAGE ?? 'aveline-backup:pilot-readiness';
  Object.assign(process.env, { OPS_REHEARSAL_IMAGE: api, OPS_REHEARSAL_BACKUP_IMAGE: backup, PILOT_REHEARSAL_IMAGE: api, BACKUP_REHEARSAL_IMAGE: backup });
  try { await runSteps(stepsFor(layer)); }
  catch (error) {
    if (['integration', 'http'].includes(layer)) await executeStep({ command: process.execPath, args: ['scripts/ci-test-results.mjs', `/tmp/aveline-${layer}-results.json`] });
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch((error) => { console.error(error.message); process.exitCode = 1; });
