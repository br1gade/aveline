#!/usr/bin/env node
/**
 * Lists every changed path outside frontend/: committed on this branch against its base, staged,
 * unstaged or untracked. An empty list is the only passing result (docs/WORKFLOW.md §5).
 *
 * The base is origin/frontend/integration once it exists, origin/main until then, or
 * BOUNDARY_BASE when set.
 */
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * Paths from `git status -z`. Not trimmed: each entry starts with a two-column status that may
 * begin with a space. A rename or copy is followed by its original path, which is skipped.
 */
function statusPaths() {
  const entries = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    encoding: 'utf8',
  }).split('\0');
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') index += 1;
  }
  return paths;
}

function refExists(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

function lines(text) {
  return text ? text.split('\n').filter(Boolean) : [];
}

const repo = git(['rev-parse', '--show-toplevel']);
process.chdir(repo);

const base =
  process.env.BOUNDARY_BASE ??
  (refExists('origin/frontend/integration') ? 'origin/frontend/integration' : 'origin/main');

const committed = refExists(base) ? lines(git(['diff', '--name-only', `${base}...HEAD`])) : [];
const working = statusPaths();

const outside = [...new Set([...committed, ...working])]
  .filter((path) => !path.startsWith('frontend/'))
  .sort();

if (outside.length > 0) {
  console.error(
    `Changes outside frontend/ (base ${base}):\n${outside.map((p) => `  ${p}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`Boundary clean: every change since ${base} is inside frontend/.`);
