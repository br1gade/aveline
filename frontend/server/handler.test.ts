// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { plantedToken } from '../test/tokens';
import { createHandler } from './handler.ts';

const token = plantedToken();
let root: string;
let server: Server;
let port: number;
const lines: string[] = [];
const errors: string[] = [];
const renderPage = vi.fn((_request: unknown, response: { end: (body: string) => void }) => {
  response.end('page');
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'aveline-handler-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'app-abc.js'), 'javascript');
  const handle = createHandler({
    client: root,
    renderPage,
    log: (line) => lines.push(line),
    logError: (line) => errors.push(line),
  });
  server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true });
});
afterEach(() => {
  lines.length = 0;
  errors.length = 0;
  renderPage.mockClear();
});

/** A raw request: `fetch` would tidy the path, and these shapes are the point. */
function send(path: string, method = 'GET', host = '127.0.0.1') {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const request = httpRequest(
        { port, path, method, host: '127.0.0.1', headers: { host } },
        (response) => {
          let body = '';
          response.on('data', (chunk) => (body += String(chunk)));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, body, headers: response.headers }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    },
  );
}

/** The `finish` event, which writes the line, comes just after the answer's end. */
async function logged(): Promise<string> {
  await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
  return lines.join('\n');
}

describe('the production server', () => {
  it('logs each request with its credential and query out', async () => {
    await send(`/invitations/a/g/${token}?locale=hy&q=${token}`);
    const line = await logged();
    expect(line).not.toContain(token);
    expect(JSON.parse(line)).toEqual({
      method: 'GET',
      path: '/invitations/a/g/[token]',
      status: 200,
      ms: expect.any(Number) as number,
    });
  });

  it('hands a page to the router', async () => {
    const { body } = await send(`/tickets/${token}`);
    expect(body).toBe('page');
    expect(renderPage).toHaveBeenCalledOnce();
  });

  it.each([`/tickets/${token}%zz`, `/invitations/a/g/${token}%`])(
    'ends %s with a 400, before the router could warn with it',
    async (path) => {
      const { status } = await send(path);
      expect(status).toBe(400);
      expect(renderPage).not.toHaveBeenCalled();
      const line = await logged();
      expect(line).not.toContain(token);
      expect(JSON.parse(line)).toMatchObject({ path: '[unreadable]', status: 400 });
    },
  );

  it('ends a Host no address can be made from with a 400', async () => {
    const { status } = await send(`/tickets/${token}`, 'GET', 'a b');
    expect(status).toBe(400);
    expect(renderPage).not.toHaveBeenCalled();
    expect(await logged()).not.toContain(token);
  });

  it('serves a built file, kept a year, typed, and never sniffed', async () => {
    const { status, body, headers } = await send('/assets/app-abc.js');
    expect(status).toBe(200);
    expect(body).toBe('javascript');
    expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(renderPage).not.toHaveBeenCalled();
  });

  it('answers HEAD with the size and no body', async () => {
    const { body, headers } = await send('/assets/app-abc.js', 'HEAD');
    expect(body).toBe('');
    expect(headers['content-length']).toBe('10');
  });

  it('serves no file to a write, which goes to the router', async () => {
    const { body } = await send('/assets/app-abc.js', 'POST');
    expect(body).toBe('page');
  });

  it('answers the health check without logging it', async () => {
    const { status, body } = await send('/healthz');
    expect(status).toBe(200);
    expect(body).toBe('ok');
    expect(lines).toEqual([]);
  });

  it('answers a page that throws with a 500, its error redacted', async () => {
    renderPage.mockImplementationOnce(() => {
      throw new Error(`failed on /tickets/${token}`);
    });
    const { status } = await send(`/tickets/${token}`);
    expect(status).toBe(500);
    expect(errors.join()).toContain('/tickets/[token]');
    expect(errors.join()).not.toContain(token);
  });
});
