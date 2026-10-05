#!/usr/bin/env node
/**
 * Fails when documentation contradicts the code.
 *
 * The docs-sync hook catches "code changed and no doc changed". It cannot
 * catch "the doc says something that is no longer true" — which is the worse
 * failure, because a wrong doc is believed. This checks the claims that can
 * be verified mechanically.
 *
 * Run by `npm run verify`.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(backend, '..');
const problems = [];

const read = (p) => readFileSync(p, 'utf8');
const docFiles = [
  ...readdirSync(join(repo, 'docs')).map((f) => join(repo, 'docs', f)),
  join(repo, 'README.md'),
  join(repo, 'CLAUDE.md'),
  join(backend, 'README.md'),
].filter((f) => f.endsWith('.md'));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// ── 1. Every file path a doc links to must exist ──────────────────────
for (const file of docFiles) {
  const links = read(file).matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g);
  for (const [, target] of links) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const resolved = resolve(dirname(file), target);
    if (!existsSync(resolved)) {
      problems.push(`${file.replace(repo + '/', '')}: broken link → ${target}`);
    }
  }
}

// ── 2. Documented endpoints must match the controllers ────────────────
const normalise = (path) => path.replace(/:\w+/g, ':x').replace(/\?.*$/, '').replace(/\/$/, '');

const actualRoutes = new Set();
for (const file of walk(join(backend, 'src')).filter((f) => f.endsWith('.controller.ts'))) {
  const src = read(file);
  const base = src.match(/@Controller\('([^']*)'\)/)?.[1] ?? '';
  for (const [, verb, path] of src.matchAll(/@(Get|Post|Patch|Put|Delete)\('?([^')]*)'?\)/g)) {
    const full = ['api', base, path].filter(Boolean).join('/');
    actualRoutes.add(`${verb.toUpperCase()} ${normalise('/' + full)}`);
  }
}

const documentedRoutes = new Set();
for (const line of read(join(backend, 'README.md')).split('\n')) {
  const row = line.match(/^\|\s*`(GET|POST|PATCH|PUT|DELETE)`\s*\|\s*`([^`]+)`/);
  if (!row) continue;
  // One row per route, deliberately: a cell listing several paths is
  // ambiguous to a reader and to this check alike.
  const [, verb, path] = row;
  documentedRoutes.add(`${verb} ${normalise(path)}`);
}

for (const route of actualRoutes) {
  if (!documentedRoutes.has(route)) problems.push(`backend/README.md: route not documented → ${route}`);
}
for (const route of documentedRoutes) {
  if (!actualRoutes.has(route)) problems.push(`backend/README.md: documents a route that does not exist → ${route}`);
}

// ── 3. Permissions in ACCESS_CONTROL.md must match the policy ─────────
const policy = read(join(backend, 'src/modules/access/access-policy.ts'));
const permissionBlock = policy.slice(policy.indexOf('ALL_PERMISSIONS'), policy.indexOf('] as const'));
const actualPermissions = new Set([...permissionBlock.matchAll(/'([a-z]+:[a-z:]+)'/g)].map((m) => m[1]));
const accessDoc = read(join(repo, 'docs/ACCESS_CONTROL.md'));
for (const permission of actualPermissions) {
  if (!accessDoc.includes(`\`${permission}\``)) {
    problems.push(`docs/ACCESS_CONTROL.md: permission not documented → ${permission}`);
  }
}

// ── 4. The module tree in ARCHITECTURE.md must match src/ ─────────────
const architecture = read(join(repo, 'docs/ARCHITECTURE.md'));
for (const area of ['infra', 'modules']) {
  for (const entry of readdirSync(join(backend, 'src', area), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!new RegExp(`\\b${entry.name}/`).test(architecture)) {
      problems.push(`docs/ARCHITECTURE.md: src/${area}/${entry.name}/ missing from the module tree`);
    }
  }
}

// ── report ────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error(`\nDocumentation has drifted from the code (${problems.length}):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('\nA wrong doc is worse than no doc, because it is believed.\n');
  process.exit(1);
}
console.log('Docs match the code.');
