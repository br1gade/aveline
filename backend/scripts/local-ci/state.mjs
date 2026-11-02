import { mkdir, readFile, writeFile, rename, open, unlink, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { output } from './process.mjs';
import { isValidProof } from './policy.mjs';
export async function repository() { return output('git', ['rev-parse', '--show-toplevel']); }
export async function revision(root, ref = 'HEAD') {
  const commit = await output('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root });
  const tree = await output('git', ['rev-parse', `${commit}^{tree}`], { cwd: root });
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(tree)) throw new Error('Unsupported Git revision');
  return { commit, tree };
}
export async function cachedProof(root, tree) {
  try {
    try { await access(join(root, '.local-ci/run.lock')); return null; } catch (error) { if (error.code !== 'ENOENT') return null; }
    const proof = JSON.parse(await readFile(join(root, '.local-ci/proofs', `${tree}.json`), 'utf8'));
    return isValidProof(proof, tree) ? proof : null;
  } catch { return null; }
}
export async function withRunLock(root, tree, callback) {
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error('Invalid source tree');
  await mkdir(join(root, '.local-ci'), { recursive: true, mode: 0o700 });
  const path = join(root, '.local-ci/run.lock');
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch { throw new Error('Local CI is already running. Check the recorded PID before removing a stale run.lock'); }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await rm(join(root, '.local-ci/proofs', `${tree}.json`), { force: true });
    return await callback();
  } finally { await handle.close(); await unlink(path); }
}
export async function saveJson(path, value) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
export async function saveProof(root, proof) {
  const directory = join(root, '.local-ci/proofs');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await saveJson(join(directory, `${proof.tree}.json`), proof);
}
