import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMethodTimings } from './method-timings.mjs';

test('method diagnostics bound samples and retain names/timing only, including failures', async () => {
  const timings = createMethodTimings(2);
  const target = { async read(value) { if (value === 'fail') throw new Error('private failure'); return value; } };
  timings.wrap('known.read', target, 'read');
  assert.equal(await target.read('secret capability'), 'secret capability');
  await assert.rejects(() => target.read('fail'));
  await target.read('extra');
  const report = timings.snapshot();
  assert.equal(report['known.read'].count, 3); assert.equal(report['known.read'].sampled, 2);
  assert.ok(!JSON.stringify(report).includes('secret'));
  timings.clear(); assert.deepEqual(timings.snapshot(), {});
});
