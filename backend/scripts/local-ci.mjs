import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { output, stopProcesses } from './local-ci/process.mjs';
import { repository, revision, cachedProof } from './local-ci/state.mjs';
import { pushCommits } from './local-ci/policy.mjs';
import { runCi } from './local-ci/run.mjs';
async function main() {
  process.once('SIGINT', stopProcesses); process.once('SIGTERM', stopProcesses);
  const command = process.argv[2] ?? 'run';
  const { values } = parseArgs({ args: process.argv.slice(3), options: { revision: { type: 'string' }, jobs: { type: 'string', default: '1' } } });
  if (!['1', '2'].includes(values.jobs)) throw new Error('Use --jobs 1 or 2');
  const root = await repository();
  if (command === 'install-hook') return installHook(root);
  if (command === 'pre-push') {
    // Git finishes this finite stream before the hook runs any Docker work.
    // Read the descriptor directly; stdin may already be closed after Git probes.
    const source = readFileSync(0, 'utf8');
    if (source.length > 1048576) throw new Error('Too many push updates');
    for (const commit of pushCommits(source)) {
      const target = await revision(root, commit);
      if (await cachedProof(root, target.tree)) console.log(`Local CI: reusing complete proof for ${commit.slice(0, 12)}`);
      else await runCi(root, target, Number(values.jobs));
    }
    return;
  }
  const target = await revision(root, values.revision);
  if (command === 'status') {
    const proof = await cachedProof(root, target.tree);
    if (!proof) throw new Error('No complete proof for this tree in the last 24 hours');
    return console.log(`Local CI passed: ${target.commit.slice(0, 12)}; evidence: ${proof.evidence}`);
  }
  if (command !== 'run') throw new Error('Use run, status, install-hook or pre-push');
  if (await output('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root })) throw new Error('Commit or stash changes first. Local CI tests the exact committed snapshot, never an uncommitted worktree');
  await runCi(root, target, Number(values.jobs));
}
async function installHook(root) {
  const common = resolve(root, await output('git', ['rev-parse', '--git-common-dir'], { cwd: root }));
  const directory = join(common, 'aveline-local-ci-hooks');
  let configured = ''; try { configured = await output('git', ['config', '--get', 'core.hooksPath'], { cwd: root }); } catch {}
  if (configured && resolve(root, configured) !== directory) throw new Error('A custom Git hook directory exists; preserve it and invoke backend/scripts/local-ci.mjs pre-push from that hook');
  const legacy = await output('git', ['rev-parse', '--git-path', 'hooks/pre-push'], { cwd: root });
  try { await lstat(resolve(root, legacy)); throw new Error('An existing pre-push hook must be integrated explicitly'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = await readFile(join(root, '.githooks/pre-push'), 'utf8');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await writeFile(join(directory, 'pre-push'), source, { flag: 'wx', mode: 0o755 }); }
  catch (error) { if (error.code !== 'EEXIST' || await readFile(join(directory, 'pre-push'), 'utf8') !== source) throw new Error('Preserve the existing local CI hook; it differs from the tracked template'); }
  await output('git', ['config', '--local', 'core.hooksPath', directory], { cwd: root });
  console.log('Installed the persistent local CI pre-push hook for this repository and its worktrees.');
}
void main().catch((error) => { console.error(`Local CI: ${error.message}`); process.exitCode = 1; });
