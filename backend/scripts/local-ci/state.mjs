import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
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
    const proof = JSON.parse(await readFile(join(root, '.local-ci/proofs', `${tree}.json`), 'utf8'));
    return isValidProof(proof, tree) ? proof : null;
  } catch { return null; }
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
