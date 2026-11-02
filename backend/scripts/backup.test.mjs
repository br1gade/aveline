import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const script = new URL('backup.sh', import.meta.url).pathname;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aveline-backup-test-'));
  for (const name of ['bin', 'backups', 'media', 'metadata']) await mkdir(join(root, name));
  await writeFile(join(root, 'media', 'photo'), 'synthetic photo');
  await writeFile(join(root, 'metadata', 'db.sqlite'), 'synthetic stopped metadata');
  for (const [name, source] of Object.entries({
    pg_dump: '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do case "$1" in --file=*) printf dump > "${1#--file=}";; esac; shift; done\n',
    pg_restore: '#!/bin/sh\nexit 0\n',
    restic: '#!/bin/sh\nexit "${RESTIC_TEST_EXIT:-0}"\n',
  })) {
    await writeFile(join(root, 'bin', name), source);
    await chmod(join(root, 'bin', name), 0o700);
  }
  return { root, env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, POSTGRES_USER: 'test',
    BACKUP_DIR: join(root, 'backups'), GARAGE_DATA_DIR: join(root, 'media'), GARAGE_META_DIR: join(root, 'metadata'),
  } };
}

test('refuses an uncoordinated live metadata archive before creating a recovery set', async () => {
  const { root, env } = await fixture();
  try {
    await assert.rejects(execute('/bin/sh', [script], { env }), /quiesced/);
    assert.deepEqual(await readdir(env.BACKUP_DIR), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('captures a complete checked database/media pair without claiming off-host success', async () => {
  const { root, env } = await fixture();
  try {
    await execute('/bin/sh', [script], { env: { ...env, BACKUP_QUIESCED: 'true', BACKUP_RUN_ID: 'fixture' } });
    const set = join(env.BACKUP_DIR, 'fixture');
    const manifest = JSON.parse(await readFile(join(set, 'manifest.json'), 'utf8'));
    assert.equal(manifest.runId, 'fixture');
    assert.equal(manifest.captureMode, 'quiesced');
    await execute('sha256sum', ['--check', 'checksums.txt'], { cwd: set });
    await assert.rejects(readFile(join(env.BACKUP_DIR, 'offhost-success.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed remote upload preserves the recovery set and previous success marker', async () => {
  const { root, env } = await fixture();
  try {
    await execute('/bin/sh', [script], { env: { ...env, BACKUP_QUIESCED: 'true', BACKUP_RUN_ID: 'fixture' } });
    const marker = join(env.BACKUP_DIR, 'offhost-success.json');
    await writeFile(marker, '{"runId":"previous"}\n');
    await assert.rejects(execute('/bin/sh', [new URL('backup-upload.sh', import.meta.url).pathname, 'fixture'], {
      env: { ...env, RESTIC_REPOSITORY: 's3:https://backup.example.test/pilot', RESTIC_PASSWORD: 'synthetic', RESTIC_TEST_EXIT: '1' },
    }));
    assert.equal(JSON.parse(await readFile(marker, 'utf8')).runId, 'previous');
    assert.ok((await readdir(env.BACKUP_DIR)).includes('fixture'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt recovery sets cannot be uploaded or marked successful', async () => {
  const { root, env } = await fixture();
  try {
    await execute('/bin/sh', [script], { env: { ...env, BACKUP_QUIESCED: 'true', BACKUP_RUN_ID: 'fixture' } });
    await writeFile(join(env.BACKUP_DIR, 'fixture', 'postgres.dump'), 'corrupted');
    await assert.rejects(execute('/bin/sh', [new URL('backup-upload.sh', import.meta.url).pathname, 'fixture'], {
      env: { ...env, RESTIC_REPOSITORY: 's3:https://backup.example.test/pilot', RESTIC_PASSWORD: 'synthetic' },
    }));
    await assert.rejects(readFile(join(env.BACKUP_DIR, 'offhost-success.json')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function coordinatorFixture() {
  const { root, env } = await fixture();
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, '.backup'));
  await copyFile(new URL('capture-backup.sh', import.meta.url), join(root, 'scripts', 'capture-backup.sh'));
  const docker = `#!/bin/sh
printf '%s\\n' "$*" >> "$COORDINATOR_LOG"
case "$*" in
  *"ps --services --status running") printf 'api\\nexport-worker\\nseating-worker\\nprivate-media-worker\\ntemplate-asset-worker\\ngarage\\n';;
  *"ps --all --quiet "*) printf 'abcdef123456\\n';;
  "start "*) exit "\${RESUME_TEST_EXIT:-0}";;
  *" start "*) echo 'refuse Compose dependency reconciliation during resume' >&2; exit 1;;
  *"/scripts/backup.sh") exit "\${CAPTURE_TEST_EXIT:-0}";;
esac
`;
  await writeFile(join(root, 'bin', 'docker'), docker, { mode: 0o700 });
  return { root, env: { ...env, COORDINATOR_LOG: join(root, 'actions') }, script: join(root, 'scripts', 'capture-backup.sh') };
}

test('failed coordinated capture resumes writers and never uploads an incomplete set', async () => {
  const { root, env, script: coordinator } = await coordinatorFixture();
  try {
    await assert.rejects(execute('bash', [coordinator], { env: { ...env, CAPTURE_TEST_EXIT: '1' } }));
    const actions = await readFile(env.COORDINATOR_LOG, 'utf8');
    assert.match(actions, /stop --timeout 60 api export-worker seating-worker private-media-worker template-asset-worker garage/u);
    assert.match(actions, /ps --all --quiet template-asset-worker/u);
    assert.match(actions, /start abcdef123456/u);
    assert.doesNotMatch(actions, /compose .* start /u);
    assert.doesNotMatch(actions, /backup-upload/u);
    await assert.rejects(readFile(join(root, '.backup', 'resume-services')), /ENOENT/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('retains a failed resume journal and recovers it on the next boot-only invocation', async () => {
  const { root, env, script: coordinator } = await coordinatorFixture();
  const journal = join(root, '.backup', 'resume-services');
  try {
    await writeFile(journal, 'api\nexport-worker\nseating-worker\ngarage\n');
    await assert.rejects(execute('bash', [coordinator, '--resume-only'], { env: { ...env, RESUME_TEST_EXIT: '1' } }));
    assert.equal(await readFile(journal, 'utf8'), 'api\nexport-worker\nseating-worker\ngarage\n');
    await execute('bash', [coordinator, '--resume-only'], { env });
    await assert.rejects(readFile(journal), /ENOENT/u);
    assert.doesNotMatch(await readFile(env.COORDINATOR_LOG, 'utf8'), /backup\.sh/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
