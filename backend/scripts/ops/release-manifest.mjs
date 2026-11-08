import { readFile, writeFile } from 'node:fs/promises';
import { assertProductionOrigins, validateManifest } from './plan.mjs';
const [command, file, runFile] = process.argv.slice(2);
try {
  if (command === 'check-origins') {
    assertProductionOrigins(process.env.APP_ORIGIN, process.env.MEDIA_ORIGIN);
  } else if (command === 'create') {
    const manifest = { version: 2, repository: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      api: process.env.API_REF, backup: process.env.BACKUP_REF, web: process.env.WEB_REF,
      appOrigin: process.env.APP_ORIGIN, mediaOrigin: process.env.MEDIA_ORIGIN };
    validateManifest(manifest, manifest);
    await writeFile(file, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  } else if (command === 'verify') {
    const run = JSON.parse(await readFile(runFile, 'utf8'));
    if (run.conclusion !== 'success' || run.event !== 'workflow_dispatch' || run.path !== '.github/workflows/release.yml'
      || run.head_repository?.full_name !== process.env.GITHUB_REPOSITORY || run.head_branch !== process.env.DEFAULT_BRANCH || String(run.id) !== process.env.RELEASE_RUN_ID) throw new Error('Untrusted release run');
    const manifest = validateManifest(JSON.parse(await readFile(file, 'utf8')), { repository: process.env.GITHUB_REPOSITORY, commit: run.head_sha, runId: run.id });
    await writeFile(process.env.GITHUB_OUTPUT, `commit=${manifest.commit}\napi=${manifest.api}\nbackup=${manifest.backup}\nweb=${manifest.web}\n`, { flag: 'a' });
  } else throw new Error('Unknown manifest operation');
} catch { console.error('Release manifest/run validation failed'); process.exitCode = 1; }
