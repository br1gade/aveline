import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
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
