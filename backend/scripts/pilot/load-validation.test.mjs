import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertInvitationWave } from './load.mjs';

test('profiled response bytes are validated for identity, locale and private caching after a concurrent wave', () => {
  const guests = [{ id: 'person', locale: 'fr' }];
  const response = (id = 'person', locale = 'fr', policy = 'private, no-store') => ({ buffer: Buffer.from(JSON.stringify({ guest: { id }, locale })),
    headers: new Headers({ 'content-type': 'application/json', 'cache-control': policy }) });
  assert.doesNotThrow(() => assertInvitationWave(guests, [response()]));
  for (const invalid of [response('wrong'), response('person', 'en'), response('person', 'fr', 'public'), { ...response(), buffer: Buffer.from('broken json') }]) {
    assert.throws(() => assertInvitationWave(guests, [invalid]));
  }
});
