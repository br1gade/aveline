import { parseArgs } from 'node:util';
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildConfiguration, writeProfile, readProfile, saveEnvironment } from './ops/config.mjs';
import { releasePlan, WRITERS } from './ops/plan.mjs';
import { context, compose, readState, withDeploymentLock } from './ops/runtime.mjs';
import { applyRelease, captureBackup } from './ops/deploy.mjs';
import { askQuestions } from './ops/wizard.mjs';
import { writeHostJobs } from './ops/jobs.mjs';
const options = Object.fromEntries(['directory', 'mode', 'project', 'answers', 'image', 'backup-image', 'confirm', 'key', 'sequence', 'release-root', 'operator-user', 'source-env', 'garage-config'].map((key) => [key, { type: 'string' }]));
Object.assign(options, { prebuilt: { type: 'boolean' }, stdin: { type: 'boolean' }, 'resume-only': { type: 'boolean' }, 'new-install': { type: 'boolean' }, 'latest-verified': { type: 'boolean' } });
async function main() {
  const command = process.argv[2] ?? 'help';
  const { values } = parseArgs({ args: process.argv.slice(3), options });
  const directory = resolve(values.directory ?? `.deployment/${values.mode ?? 'local'}`);
  if (command === 'import') return importProfile(directory, values);
  if (command === 'init') return initialize(directory, values);
  if (command === 'help') return console.log('Aveline ops: init | import | configure --key KEY [--stdin] | sync | check | plan | apply --confirm PROJECT | status | stop-writers | backup [--resume-only] | backup-init | backup-check | journal-init --new-install | journal-recover --latest-verified --sequence N | rollback-plan | jobs --release-root PATH --operator-user USER. Use --directory PROFILE. Maintenance commands require --confirm PROJECT; apply/plan accept --image DIGEST --backup-image DIGEST. See docs/DEPLOYMENT.md and docs/RELEASES.md.');
  const profile = await readProfile(directory, { canRepairRuntime: command === 'sync' });
  if (command === 'jobs') return console.log(`Generated unit templates in ${await writeHostJobs(profile, values['release-root'], values['operator-user'])}; review and install them explicitly. No timers were enabled.`);
  if (command === 'sync') return withDeploymentLock({ profile }, () => saveEnvironment(profile));
  if (command === 'configure') return withDeploymentLock({ profile }, () => configure(profile, values));
  const state = await readState(profile);
  const images = { api: values.image ?? state?.api ?? profile.env.API_IMAGE, backup: values['backup-image'] ?? state?.backup ?? profile.env.BACKUP_IMAGE };
  const ctx = context(profile, images);
  if (['backup', 'backup-init', 'backup-check', 'journal-init', 'journal-recover'].includes(command)) releasePlan(profile, images);
  if (command === 'plan') return console.log(JSON.stringify({ project: profile.settings.project, images, stages: releasePlan(profile, images) }, null, 2));
  if (command === 'apply') return applyRelease(profile, images, values.confirm, { isPrebuilt: values.prebuilt });
  if (command === 'check') { await compose(ctx, ['config', '--quiet'], 'validate configuration'); return console.log('Compose configuration is valid. Feature and payment gates were not changed.'); }
  if (command === 'status') return console.log(await compose(ctx, ['ps', '--format', '{{.Service}} {{.State}} {{.Health}}'], 'read status'));
  if (command === 'rollback-plan') {
    if (!state?.previous) throw new Error('No previous release is recorded');
    return console.log(JSON.stringify({ images: state.previous, requiresMaintenance: true, steps: releasePlan(profile, state.previous), databaseDowngrade: false, readerPreflightRequired: true }, null, 2));
  }
  if (values.confirm !== profile.settings.project) throw new Error('Use --confirm with the exact project name');
  if (command === 'backup-check') return withDeploymentLock(ctx, () => compose(ctx, ['run', '--rm', '--no-deps', 'backup-check'], 'backup freshness check'));
  if (command === 'backup') return withDeploymentLock(ctx, () => captureBackup(ctx, state?.api, values['resume-only']));
  if (command === 'stop-writers') return withDeploymentLock(ctx, () => compose(ctx, ['stop', '--timeout', '60', ...WRITERS], 'stop application writers'));
  if (command === 'backup-init') return withDeploymentLock(ctx, () => compose(ctx, ['run', '--rm', '--no-deps', 'backup', 'restic', 'init'], 'initialize configured encrypted recovery repository'));
  if (command === 'journal-init' || command === 'journal-recover') return withDeploymentLock(ctx, async () => {
    const running = (await compose(ctx, ['ps', '--services', '--status', 'running'], 'verify writers stopped')).trim().split(/\s+/);
    if (WRITERS.some((service) => running.includes(service))) throw new Error('Stop all application writers before journal maintenance');
    const args = ['run', '--rm', '--no-deps', '-e', 'RESTORE_QUIESCED=true'];
    if (command === 'journal-init' && values['new-install']) args.push('-e', 'SALES_PRIVACY_NEW_INSTALL=true', 'privacy-recovery', 'initialize');
    else if (command === 'journal-recover' && values['latest-verified'] && /^\d+$/.test(values.sequence ?? '') && Number.isSafeInteger(Number(values.sequence))) args.push('-e', 'SALES_PRIVACY_JOURNAL_LATEST_VERIFIED=true', '-e', `SALES_PRIVACY_RESTORE_SEQUENCE=${values.sequence}`, 'privacy-recovery');
    else throw new Error('Explicit fresh-install or independently verified latest sequence is required');
    await compose(ctx, args, 'offline journal maintenance');
  });
  throw new Error('Unknown operation; use help');
}
async function importProfile(directory, values) {
    if (!values['source-env'] || !values['garage-config'] || !['local', 'production'].includes(values.mode) || !/^[a-z][a-z0-9-]{2,31}$/.test(values.project ?? '')) throw new Error('Import requires explicit mode/project and protected source env/Garage files');
    const { decodeEnvironment } = await import('./ops/config.mjs');
    const env = decodeEnvironment(await readFile(values['source-env'], 'utf8'));
    if (env.COMPOSE_PROJECT_NAME !== values.project) throw new Error('Imported project identity differs; preserve the original volume names');
    await writeProfile(directory, { settings: { version: 1, mode: values.mode, project: values.project }, env, garage: await readFile(values['garage-config'], 'utf8') });
    return console.log('Imported configuration without rotating keys. Independently restore the latest privacy journal before serving restored data.');
}
async function initialize(directory, values) {
  let answers;
  if (values.answers) {
    if ((await lstat(values.answers)).mode & 0o077) throw new Error('Answers file must be private (0600)');
    answers = JSON.parse(await readFile(values.answers, 'utf8'));
  } else answers = process.stdin.isTTY ? await askQuestions(values) : values;
  await writeProfile(directory, buildConfiguration(answers));
  console.log(`Created private profile at ${directory}. No services were started. Run check, then plan/apply. Keep this directory out of source control and recovery artifacts intended for public upload.`);
}
async function configure(profile, values) {
  if (!values.key || !Object.hasOwn(profile.env, values.key) || ['COMPOSE_PROJECT_NAME', 'PRIVACY_JOURNAL_VOLUME'].includes(values.key)) throw new Error('Use --key with a known editable environment setting');
  let value;
  if (values.stdin) {
    value = ''; for await (const chunk of process.stdin) { value += chunk.toString(); if (value.length > 65536) throw new Error('Value too long'); }
    value = value.replace(/\r?\n$/, '');
  } else {
    if (!process.stdin.isTTY) throw new Error('Use --stdin for non-interactive configuration');
    value = await askQuestions({}, values.key);
  }
  profile.env[values.key] = value; await saveEnvironment(profile);
  console.log(`Updated ${values.key}; value withheld. Run check/preflight before deployment.`);
}
void main().catch((error) => { console.error(error instanceof SyntaxError ? 'Invalid protected configuration syntax; values withheld.' : error.message); process.exitCode = 1; });
