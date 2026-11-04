#!/usr/bin/env node
/**
 * Bundle budgets for the guest pages (setup proposal §10), read from the build's own route manifest:
 * the gzipped JavaScript and CSS a guest's phone downloads before the page works. The limits are the
 * sizes measured on 4 November 2026 plus a small margin, so growth is a decision, not a drift.
 * Raising one means saying why in docs/ARCHITECTURE.md §8.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const CLIENT = join(fileURLToPath(new URL('..', import.meta.url)), 'build', 'client');

/** Gzipped kilobytes. */
export const BUDGETS = {
  'routes/public/guest-invitation': { js: 300, css: 17 },
  'routes/public/invitation': { js: 205, css: 17 },
};

export function initialFiles(manifest, routeId) {
  const route = manifest.routes[routeId];
  if (!route) throw new Error(`The build has no route ${routeId}`);
  const parts = [manifest.entry, manifest.routes.root, route];
  return {
    js: [...new Set(parts.flatMap((part) => [part.module, ...(part.imports ?? [])]))],
    css: [...new Set(parts.flatMap((part) => part.css ?? []))],
  };
}

export function overBudget(size, budget) {
  return ['js', 'css']
    .filter((kind) => size[kind] > budget[kind])
    .map((kind) => ({ kind, size: size[kind], limit: budget[kind] }));
}

function readManifest() {
  const assets = join(CLIENT, 'assets');
  const file = readdirSync(assets).find((name) => /^manifest-.*\.js$/.test(name));
  if (!file) throw new Error('No route manifest: run the build first');
  const source = readFileSync(join(assets, file), 'utf8');
  return JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
}

function gzippedKb(files) {
  const bytes = files.reduce(
    (sum, file) => sum + gzipSync(readFileSync(join(CLIENT, file))).length,
    0,
  );
  return Math.ceil(bytes / 1024);
}

function main() {
  const manifest = readManifest();
  let isOver = false;
  for (const [routeId, budget] of Object.entries(BUDGETS)) {
    const { js, css } = initialFiles(manifest, routeId);
    const size = { js: gzippedKb(js), css: gzippedKb(css) };
    console.log(`${routeId}: js ${size.js}/${budget.js} KB, css ${size.css}/${budget.css} KB`);
    for (const { kind, size: at, limit } of overBudget(size, budget)) {
      console.error(`Over budget: ${routeId} ${kind} is ${at} KB, limit ${limit} KB`);
      isOver = true;
    }
  }
  process.exitCode = isOver ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
