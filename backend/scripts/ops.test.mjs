import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConfiguration, encodeEnvironment, decodeEnvironment, writeProfile, readProfile, saveEnvironment } from './ops/config.mjs';
import { releasePlan, validateManifest } from './ops/plan.mjs';
const digest = 'sha256:' + 'a'.repeat(64);
const images = { api: `ghcr.io/example/aveline/api@${digest}`, backup: `ghcr.io/example/aveline/backup@${digest}` };
const production = { mode: 'production', project: 'aveline-production', apiDomain: 'api.example.test', mediaDomain: 'media.example.test', appUrl: 'https://example.test', acmeEmail: 'ops@example.test', smtpHost: 'smtp.example.test', mailFrom: 'hello@example.test' };

test('wizard generates separate secrets and closed commercial/feature gates', () => {
  const config = buildConfiguration(production);
  assert.equal(config.env.PILOT_MODE, 'true');
  for (const key of ['SALES_INTAKE_ENABLED', 'TEMPLATE_PUBLISH_ENABLED', 'TEMPLATE_ASSETS_ENABLED']) assert.equal(config.env[key], 'false');
  assert.notEqual(config.env.JWT_SECRET, config.env.POSTGRES_PASSWORD);
  assert.ok(config.env.JWT_SECRET.length >= 48);
  assert.equal(config.env.PRIVATE_S3_BUCKET === config.env.S3_BUCKET, false);
  assert.equal(new URL(config.env.DATABASE_URL).hostname, 'postgres');
  assert.match(config.garage, /rpc_secret\s+= "[a-f0-9]{64}"/);
});

test('dotenv serialization preserves dollar, quote, slash and unicode values without command evaluation', () => {
  const values = { TOKEN: 'hello$HOME"\\world\' — բարև', JSON_KEYS: '{"v1":"' + 'x'.repeat(32) + '"}' };
  assert.deepEqual(decodeEnvironment(encodeEnvironment(values)), values);
  assert.throws(() => encodeEnvironment({ TOKEN: 'line\nbreak' }), /line/);
});

test('the interactive wizard preserves significant whitespace in secrets and trims ordinary answers', async () => {
  const { parseAnswer } = await import('./ops/wizard.mjs');
  for (const value of ['  password  ', ' ', 'quote"$HOME\\', 'Բարև']) assert.equal(parseAnswer(value, '', true), value);
  assert.equal(parseAnswer('  example.test  ', '', false), 'example.test');
  assert.equal(parseAnswer('  ', 'local', false), 'local');
  assert.equal(parseAnswer('', '', true), '');
});

test('profile files are private and initialization never overwrites existing credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aveline-ops-'));
  const profile = join(directory, 'profile');
  try {
    await writeProfile(profile, buildConfiguration({ mode: 'local', project: 'aveline-test' }));
    assert.equal((await stat(join(profile, '.env'))).mode & 0o777, 0o600);
    assert.equal((await stat(profile)).mode & 0o777, 0o700);
    const before = await readFile(join(profile, '.env'), 'utf8');
    await assert.rejects(writeProfile(profile, buildConfiguration(production)), /exist/);
    assert.equal(await readFile(join(profile, '.env'), 'utf8'), before);
    assert.equal((await readProfile(profile)).settings.project, 'aveline-test');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('production release requires immutable images and plans backup before writer shutdown/migration', () => {
  const profile = buildConfiguration(production);
  assert.throws(() => releasePlan(profile, { ...images, api: 'example/api:latest' }), /digest/);
  const plan = releasePlan(profile, images);
  assert.ok(plan.indexOf('backup-if-populated') < plan.indexOf('stop-writers'));
  assert.ok(plan.indexOf('stop-writers') < plan.indexOf('migrate'));
  assert.ok(plan.indexOf('migrate') < plan.indexOf('seed'));
  assert.ok(plan.indexOf('seed') < plan.indexOf('start-and-check'));
  assert.equal(plan.includes('down'), false);
  assert.equal(plan.includes('restore'), false);
});

test('runtime secrets remain literal and configuration drift blocks deployment until explicitly synchronized', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aveline-runtime-'));
  const directory = join(root, 'profile');
  try {
    const config = buildConfiguration({ mode: 'local' });
    config.env.SMTP_PASSWORD = 'literal-$HOME-"-\\-secret';
    await writeProfile(directory, config);
    assert.ok((await readFile(join(directory, '.runtime.env'), 'utf8')).includes(`SMTP_PASSWORD=${config.env.SMTP_PASSWORD}\n`));
    assert.equal((await stat(join(directory, '.runtime.env'))).mode & 0o777, 0o600);
    await writeFile(join(directory, '.runtime.env'), 'SMTP_PASSWORD=drift\n');
    await assert.rejects(readProfile(directory), /mirror differs/);
    await saveEnvironment(await readProfile(directory, { canRepairRuntime: true }));
    assert.equal((await readProfile(directory)).env.SMTP_PASSWORD, config.env.SMTP_PASSWORD);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a populated production deployment cannot substitute local-only capture for off-host protection', async () => {
  const { captureBackup } = await import('./ops/deploy.mjs');
  assert.throws(() => captureBackup({ profile: buildConfiguration(production), env: {} }), /off-host/);
});

test('production maintenance cannot fall back to an unapproved floating image before the first release', async () => {
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const { mkdir } = await import('node:fs/promises'); const execute = promisify(execFile);
  const root = await mkdtemp(join(tmpdir(), 'aveline-maintenance-'));
  try {
    const directory = join(root, 'profile'); await writeProfile(directory, buildConfiguration(production));
    await mkdir(join(root, 'bin'));
    await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nprintf called > "$OPS_COMMAND_LOG"\n', { mode: 0o700 });
    await assert.rejects(execute(process.execPath, [new URL('ops.mjs', import.meta.url).pathname, 'backup-init', '--directory', directory, '--confirm', production.project],
      { env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, OPS_COMMAND_LOG: join(root, 'called') } }));
    await assert.rejects(readFile(join(root, 'called')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unsafe hostnames/projects and production HTTP origins are rejected', () => {
  for (const project of ['../other', 'aveline;touch', 'UPPER', 'a b']) assert.throws(() => buildConfiguration({ ...production, project }));
  assert.throws(() => buildConfiguration({ ...production, apiDomain: 'example.test;id' }));
  assert.throws(() => buildConfiguration({ ...production, appUrl: 'http://example.test' }));
});

test('deployment manifests bind both digests to the trusted repository, run and source commit', () => {
  const manifest = { version: 1, repository: 'example/aveline', commit: 'b'.repeat(40), runId: '123', ...images };
  assert.deepEqual(validateManifest(manifest, { repository: manifest.repository, commit: manifest.commit, runId: '123' }), manifest);
  assert.throws(() => validateManifest({ ...manifest, api: `ghcr.io/attacker/api@${digest}` }, manifest), /repository/);
  assert.throws(() => validateManifest({ ...manifest, commit: 'c'.repeat(40) }, manifest), /source/);
});

test('SSH deployment rejects option/shell injection and requires pinned host identity', async () => {
  const { remoteSettings } = await import('./ops/remote.mjs');
  const valid = { DEPLOY_HOST: 'host.example.test', DEPLOY_USER: 'aveline', DEPLOY_ROOT: '/opt/aveline', DEPLOY_PROFILE: '/etc/aveline/production',
    DEPLOY_PROJECT: 'aveline-production', CONFIRM_PROJECT: 'aveline-production', DEPLOY_KNOWN_HOSTS: 'host.example.test ssh-ed25519 public', DEPLOY_SSH_KEY: 'synthetic PRIVATE KEY' };
  assert.equal(remoteSettings(valid).host, 'aveline@host.example.test');
  for (const patch of [{ DEPLOY_HOST: '-oProxyCommand=id' }, { DEPLOY_ROOT: '/tmp/x;id' }, { DEPLOY_PROFILE: '/etc/../private' }, { CONFIRM_PROJECT: 'other' }, { DEPLOY_KNOWN_HOSTS: '' }]) assert.throws(() => remoteSettings({ ...valid, ...patch }));
});

test('host-job wizard creates reviewable units without enabling timers', async () => {
  const { writeHostJobs } = await import('./ops/jobs.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'aveline-jobs-'));
  try {
    const output = await writeHostJobs({ directory, settings: { project: 'aveline-test' } }, '/opt/aveline', 'aveline');
    assert.match(await readFile(join(output, 'aveline-aveline-test-backup.timer'), 'utf8'), /Asia\/Yerevan/);
    assert.match(await readFile(join(output, 'aveline-aveline-test-backup-recover.service'), 'utf8'), /backup --resume-only/);
    await assert.rejects(writeHostJobs({ directory, settings: { project: 'aveline-test' } }, '/opt/aveline', 'aveline'), /exist/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a failed migration leaves writers stopped and never restores data or restarts the old release', async () => {
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const { mkdir, writeFile } = await import('node:fs/promises'); const execute = promisify(execFile);
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
  const root = await mkdtemp(join(tmpdir(), 'aveline-release-failure-'));
  try {
    const profile = join(root, 'profile'); await writeProfile(profile, buildConfiguration({ mode: 'local', project: 'aveline-failure' }));
    await mkdir(join(root, 'bin'));
    await writeFile(join(root, 'bin/docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$OPS_COMMAND_LOG"
case "$*" in
  'volume inspect '*) exit 1;;
  *release-preflight.mjs*) printf 'EMPTY\\n';;
  *'/garage status') printf 'HEALTHY NODES\\n';;
  *'/garage key info '*) printf 'Key ID: synthetic-id\\nSecret key: synthetic-secret\\n';;
  *'run --rm --no-deps migrate') exit 42;;
esac
`, { mode: 0o700 });
    await assert.rejects(execute(process.execPath, [new URL('ops.mjs', import.meta.url).pathname, 'apply', '--directory', profile, '--prebuilt', '--confirm', 'aveline-failure'], { env: { ...childEnv, PATH: `${root}/bin:${process.env.PATH}`, OPS_COMMAND_LOG: join(root, 'commands') } }));
    const attempt = JSON.parse(await readFile(join(profile, 'deployment-attempt.json'), 'utf8'));
    assert.equal(attempt.stage, 'migrate', attempt.reason);  assert.equal(attempt.schemaMayHaveChanged, true);
    const commands = (await readFile(join(root, 'commands'), 'utf8')).trim().split('\n');
    assert.ok(commands.some((args) => args.includes(' stop ') && args.includes('template-asset-worker')));
    assert.equal(commands.some((args) => args.includes(' up ') && args.includes('api')), false);
    assert.equal(commands.some((args) => args.includes('restore')), false);
    await assert.rejects(readFile(join(profile, 'release-state.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
