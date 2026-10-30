import { createServer } from 'node:http';
import { request } from 'node:https';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { localResourceName } from './local-ci/scope.mjs';

const execute = promisify(execFile);
const root = new URL('../', import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'aveline-edge-'));
const name = localResourceName(`aveline-edge-${process.pid}`, 'e');
const caddyImage = 'caddy:2-alpine@sha256:d44355d3c2149dc580ce2cac735955d1c08d3d00882c30489c241aa51a5c10d9';
const logs = [];
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ url: request.url, host: request.headers.host, token: request.headers['x-pilot-token'] }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const upstream = server.address().port;
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const api = `https://api.localhost:${port}`;
const media = `https://media.localhost:${port}`;
const canary = 'synthetic-guest-credential';
const path = `/api/v1/invitations/demo/g/${canary}?token=${canary}`;
let child;
let certificate;
function call(path, host, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', servername: host.split(':')[0], ca: certificate, port, path, headers: { Host: host, ...headers } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}
try {
  // Download time is not proxy startup time. Fresh CI runners have no cache.
  try { await execute('docker', ['image', 'inspect', caddyImage]); }
  catch { await execute('docker', ['pull', caddyImage], { timeout: 180000 }); }
  const source = await readFile(new URL('Caddyfile', root), 'utf8');
  const config = source.replace('\n{\n', '\n{\n\tadmin off\n\tlocal_certs\n\tauto_https disable_redirects\n')
    .replace('api:3000', `127.0.0.1:${upstream}`)
    .replace('garage:3902', `127.0.0.1:${upstream}`);
  await writeFile(join(directory, 'Caddyfile'), config);
  child = spawn('docker', ['run', '--rm', '--name', name, '--network', 'host',
    '-v', `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
    '-e', `API_DOMAIN=${api}`, '-e', `MEDIA_DOMAIN=${media}`,
    '-e', 'MEDIA_BUCKET_HOST=aveline-media.web.garage.localhost',
    '-e', 'ACME_EMAIL=ops@aveline.test', caddyImage], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  let isReady = false;
  for (let attempt = 0; attempt < 100 && !isReady; attempt++) {
    try {
      certificate ??= (await execute('docker', ['exec', name, 'cat', '/data/caddy/pki/authorities/local/root.crt'])).stdout;
      const response = await call('/health', `api.localhost:${port}`);
      isReady = response.status === 200 && response.body.includes('/health');
    } catch {}
    if (!isReady) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(isReady, 'Caddy must start with the production configuration');
  const response = await call(path, `api.localhost:${port}`, {
    'x-pilot-token': canary,
    Referer: `https://aveline.test/g/${canary}`, Authorization: `Bearer ${canary}`,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { url: path, host: `api.localhost:${port}`, token: canary });
  const image = await call('/photo.png', `media.localhost:${port}`);
  assert.equal(image.status, 200);
  assert.equal(JSON.parse(image.body).host, 'aveline-media.web.garage.localhost');
  await new Promise((resolve) => server.close(resolve));
  const outage = await call(path, `api.localhost:${port}`, { Authorization: `Bearer ${canary}`, Referer: `https://aveline.test/g/${canary}` });
  assert.equal(outage.status, 502, 'must exercise proxy errors as well as successful requests');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const access = logs.join('').split('\n').filter((line) => line.includes('http.log.access'));
  assert.ok(access.length > 0, 'must exercise real Caddy access logs');
  assert.ok(!logs.join('').includes(canary), 'credential must not occur in proxy logs');
  for (const line of access) {
    const entry = JSON.parse(line);
    assert.equal(entry.request.uri, undefined);
    assert.equal(entry.request.headers, undefined);
  }
  console.log('Production Caddy: verified local TLS, routing preserved, media bucket selected, credentials absent from success and 502 error logs.');
} catch (error) {
  const message = String(error.message).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  if (process.env.GITHUB_ACTIONS === 'true') console.error(`::error file=backend/scripts/test-edge.mjs::${message}`);
  throw error;
} finally {
  if (child) await execute('docker', ['rm', '-f', '-v', name]).catch(() => undefined);
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
