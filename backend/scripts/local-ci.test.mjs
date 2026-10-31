import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushCommits, isValidProof, isLocalDockerEndpoint } from './local-ci/policy.mjs';
import { stepsFor } from './ci-job.mjs';
const tree = 'a'.repeat(40); const now = Date.now();
const proof = { version: 1, tree, completedAt: new Date(now).toISOString(), layers: ['quality', 'containers', 'integration', 'http'], imageId: 'sha256:' + 'b'.repeat(64) };

test('push validation checks every distinct nondeleted commit and rejects malformed updates', () => {
  const oid = 'c'.repeat(40); const zero = '0'.repeat(40);
  assert.deepEqual(pushCommits(`refs/heads/dev ${oid} refs/heads/dev ${zero}\nrefs/tags/v1 ${oid} refs/tags/v1 ${zero}\n(delete) ${zero} refs/heads/old ${oid}\n`), [oid]);
  assert.throws(() => pushCommits('refs/heads/dev HEAD refs/heads/dev bad'), /Invalid/);
  assert.throws(() => pushCommits('missing fields'), /Invalid/);
  assert.deepEqual(pushCommits(''), []);
});

test('only a complete, fresh proof for the exact pushed tree permits reuse', () => {
  assert.equal(isValidProof(proof, tree, now), true);
  for (const patch of [{ tree: 'd'.repeat(40) }, { version: 0 }, { layers: ['quality', 'integration', 'http'] }, { layers: ['quality', 'quality', 'integration', 'http'] }, { imageId: '' },
    { completedAt: new Date(now - 86400001).toISOString() }, { completedAt: new Date(now + 1).toISOString() }, { completedAt: 'invalid' }]) assert.equal(isValidProof({ ...proof, ...patch }, tree, now), false);
  assert.equal(isValidProof(null, tree, now), false);
});

test('local checks refuse remote Docker endpoints', () => {
  assert.equal(isLocalDockerEndpoint('unix:///var/run/docker.sock'), true);
  for (const endpoint of ['ssh://production', 'tcp://example.test:2376', '', undefined]) assert.equal(isLocalDockerEndpoint(endpoint), false);
});

test('shared CI plans preserve all layers and forbid unknown jobs', () => {
  const commands = stepsFor('quality').map((step) => step.args.join(' ')).join('\n');
  for (const script of ['lint', 'docs:check', 'openapi:check', 'build', 'test:unit', 'test:pilot', 'test:backup', 'test:ops', 'test:ci']) assert.ok(commands.includes(script));
  assert.ok(stepsFor('integration').some((step) => step.args.includes('test:int')));
  assert.ok(stepsFor('http').some((step) => step.args.includes('test:e2e')));
  assert.deepEqual(stepsFor('containers').filter((step) => step.command === 'docker').length, 2);
  assert.throws(() => stepsFor('release'), /Unknown/);
});

test('the shared runner stops at a failed command instead of running later checks', async () => {
  const { runSteps } = await import('./ci-job.mjs');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'aveline-ci-failure-'));
  try {
    const marker = join(directory, 'unexpected');
    await assert.rejects(runSteps([{ command: process.execPath, args: ['-e', 'process.exit(7)'] },
      { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1],"ran")', marker] }]), /failed \(7\)/);
    await assert.rejects(readFile(marker), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local rehearsals retain their default names and accept only a private CI namespace override', async () => {
  const { localResourceName } = await import('./local-ci/scope.mjs');
  assert.equal(localResourceName('default', 'c', {}), 'default');
  assert.match(localResourceName('default', 'c', { AVELINE_LOCAL_CI_SCOPE: 'av-ci-abcdef123456' }), /^av-ci-abcdef123456-c\d+$/);
  assert.throws(() => localResourceName('default', 'c', { AVELINE_LOCAL_CI_SCOPE: 'production' }), /Invalid/);
});

test('cleanup never touches other projects or a namespace whose preflight did not succeed', async () => {
  const { cleanup } = await import('./local-ci/docker.mjs');
  const calls = []; const ctx = { scope: 'av-ci-abcdef123456', wasScopeAccepted: false, image: 'ci:owned', env: { CI_API_IMAGE: 'api:owned', CI_BACKUP_IMAGE: 'backup:owned' } };
  const execute = async (_command, args) => { calls.push(args); if (args.includes('--format')) return `${ctx.scope}-owned\nproduction\nunrelated-${ctx.scope}-other`; return ''; };
  await cleanup(ctx, execute); assert.equal(calls.length, 0);
  ctx.wasScopeAccepted = true; await cleanup(ctx, execute);
  const mutations = calls.filter((args) => args.includes('rm'));
  assert.equal(mutations.length, 3);
  assert.ok(mutations.every((args) => args.at(-1) === `${ctx.scope}-owned`));
});

test('proofs are private and a different tree or incomplete run cannot satisfy the gate', async () => {
  const { saveProof, cachedProof } = await import('./local-ci/state.mjs');
  const { mkdtemp, rm, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'aveline-ci-proof-'));
  try {
    await saveProof(root, proof);
    assert.ok(await cachedProof(root, tree));
    assert.equal(await cachedProof(root, 'd'.repeat(40)), null);
    assert.equal((await stat(join(root, '.local-ci/proofs', `${tree}.json`))).mode & 0o777, 0o600);
    await saveProof(root, { ...proof, layers: ['quality'] });
    assert.equal(await cachedProof(root, tree), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the pre-push CLI validates the pushed commit rather than HEAD and blocks an untested tree before remote work', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { writeFileSync, openSync, closeSync } = await import('node:fs');
  const { mkdtemp, rm, writeFile, readFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { saveProof } = await import('./local-ci/state.mjs');
  const root = await mkdtemp(join(tmpdir(), 'aveline-push-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init'); await writeFile(join(root, 'file'), 'first'); git('add', 'file');
    git('-c', 'user.name=CI', '-c', 'user.email=ci@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'first');
    const first = git('rev-parse', 'HEAD');
    await saveProof(root, { ...proof, tree: git('rev-parse', 'HEAD^{tree}') });
    await writeFile(join(root, 'file'), 'second'); git('add', 'file');
    git('-c', 'user.name=CI', '-c', 'user.email=ci@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', 'second');
    const second = git('rev-parse', 'HEAD'); const marker = join(root, 'docker-was-called');
    await mkdir(join(root, 'bin')); await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nprintf called > "$CI_TEST_MARKER"\nexit 77\n', { mode: 0o700 });
    const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, DOCKER_HOST: 'unix:///synthetic', CI_TEST_MARKER: marker }; delete env.NODE_TEST_CONTEXT;
    const invoke = (commit) => {
      const input = join(root, 'updates'); writeFileSync(input, `refs/heads/old ${commit} refs/heads/old ${'0'.repeat(40)}\n`);
      const descriptor = openSync(input, 'r');
      try { return spawnSync(process.execPath, [new URL('local-ci.mjs', import.meta.url).pathname, 'pre-push'], { cwd: root, encoding: 'utf8', timeout: 10000, stdio: [descriptor, 'pipe', 'pipe'], env }); }
      finally { closeSync(descriptor); }
    };
    assert.equal(invoke(first).status, 0);
    await assert.rejects(readFile(marker), /ENOENT/);
    const rejected = invoke(second);
    assert.equal(rejected.status, 1, JSON.stringify({ stdout: rejected.stdout, stderr: rejected.stderr }));
    assert.equal(await readFile(marker, 'utf8'), 'called');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installation persists across branch file removal and preserves custom hooks', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { mkdtemp, rm, mkdir, writeFile, readFile, stat } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'aveline-hook-install-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init'); await mkdir(join(root, '.githooks'));
    const source = await readFile(new URL('../../.githooks/pre-push', import.meta.url), 'utf8');
    await writeFile(join(root, '.githooks/pre-push'), source);
    const installed = spawnSync(process.execPath, [new URL('local-ci.mjs', import.meta.url).pathname, 'install-hook'], { cwd: root, timeout: 10000 });
    assert.equal(installed.status, 0);
    const hook = join(git('config', '--get', 'core.hooksPath'), 'pre-push');
    assert.equal(await readFile(hook, 'utf8'), source);
    assert.equal((await stat(hook)).mode & 0o111, 0o111);
    await rm(join(root, '.githooks'), { recursive: true });
    assert.equal(spawnSync('/bin/sh', [hook], { cwd: root, timeout: 10000 }).status, 1);
    git('config', 'core.hooksPath', 'custom');
    assert.equal(spawnSync(process.execPath, [new URL('local-ci.mjs', import.meta.url).pathname, 'install-hook'], { cwd: root, timeout: 10000 }).status, 1);
    assert.equal(git('config', '--get', 'core.hooksPath'), 'custom');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a new failed validation invalidates old proof and concurrent runs are refused', async () => {
  const { withRunLock, saveProof, cachedProof } = await import('./local-ci/state.mjs');
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'aveline-ci-lock-'));
  try {
    await saveProof(root, proof);
    await assert.rejects(withRunLock(root, tree, async () => {
      assert.equal(await cachedProof(root, tree), null);
      await assert.rejects(withRunLock(root, tree, async () => {}), /already running/);
      throw new Error('synthetic failure');
    }), /synthetic failure/);
    assert.equal(await cachedProof(root, tree), null);
    await assert.rejects(readFile(join(root, '.local-ci/run.lock')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Docker context selection cannot hide a remote daemon behind a local host override', async () => {
  const { dockerEndpoint } = await import('./local-ci/policy.mjs');
  const inspect = async (context) => context === 'remote' ? 'ssh://example.test' : 'unix:///var/run/docker.sock';
  assert.equal(await dockerEndpoint({ DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'unix:///var/run/docker.sock' }, inspect), 'ssh://example.test');
  assert.equal(await dockerEndpoint({ DOCKER_HOST: 'tcp://example.test:2376' }, inspect), 'tcp://example.test:2376');
  assert.equal(await dockerEndpoint({}, inspect), 'unix:///var/run/docker.sock');
});
