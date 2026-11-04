import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createRequestListener } from '@react-router/node';
import type { ServerBuild } from 'react-router';

import { createHandler } from './handler.ts';
import { requireSettings } from './settings.ts';

/**
 * The client's build and React Router, on Node's own HTTP server, logging no capability path
 * (log.ts). Compression and TLS are the proxy's in front of it (FR-11).
 */
requireSettings(process.env);

const ROOT = join(import.meta.dirname, '..');
const CLIENT = join(ROOT, 'build', 'client');
const SHUTDOWN_MS = 10_000;

const build = (await import(
  pathToFileURL(join(ROOT, 'build', 'server', 'index.js')).href
)) as ServerBuild;
const renderPage = createRequestListener({ build, mode: 'production' });

const handle = createHandler({
  client: CLIENT,
  renderPage,
  log: (line) => console.log(line),
  logError: (line) => console.error(line),
});
const server = createServer((request, response) => void handle(request, response));

function shutDown(): void {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), SHUTDOWN_MS).unref();
}
process.once('SIGTERM', shutDown);
process.once('SIGINT', shutDown);

server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0', () => {
  console.log(JSON.stringify({ listening: server.address() }));
});
