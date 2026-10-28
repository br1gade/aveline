import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createClient } from './client.mjs';

test('rehearsal JSON writes send the complete body and content type', async () => {
  let captured;
  const fetch = mock.method(globalThis, 'fetch', async (url, options) => {
    const request = new Request(url, options);
    captured = { method: request.method, type: request.headers.get('content-type'), body: await request.text() };
    return new Response('{"ok":true}', { status: 201 });
  });
  try {
    const client = createClient('http://127.0.0.1:3000');
    await client.request('POST', '/auth/login', { email: 'synthetic@example.test', password: 'Synthetic-password' });
    assert.deepEqual(captured, { method: 'POST', type: 'application/json', body: '{"email":"synthetic@example.test","password":"Synthetic-password"}' });
  } finally { fetch.mock.restore(); }
});

test('records complete bodies once and retains separate wave summaries', async (context) => {
  let finish;
  const held = new Promise((resolve) => { finish = resolve; });
  const bytes = new TextEncoder().encode('{"fixture":true}').buffer;
  let bodies = 0;
  context.mock.method(globalThis, 'fetch', async () => ({ status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    arrayBuffer: () => { bodies += 1; return bodies === 1 ? held : Promise.resolve(bytes); },
  }));
  const client = createClient('http://127.0.0.1:1234');
  const pending = client.request('GET', '/fixture', undefined, { profile: 'warm', wave: 0 });
  await new Promise(setImmediate);
  assert.deepEqual(client.profiles(), {}, 'Headers alone must not complete a timed response');
  finish(bytes); await pending;
  await client.request('GET', '/fixture', undefined, { profile: 'warm', wave: 1 });
  assert.equal(client.profiles().warm.requests, 2);
  assert.equal(client.profileWaves().warm[0].requests, 1);
  assert.equal(client.profileWaves().warm[1].requests, 1);
  assert.equal(bodies, 2);
});
