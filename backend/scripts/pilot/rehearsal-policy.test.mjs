import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireLocalTarget, summarizeSamples, evaluateBudgets } from './rehearsal-policy.mjs';

test('bulk rehearsal only accepts explicit loopback HTTP targets without credentials', () => {
  for (const url of ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000']) assert.doesNotThrow(() => requireLocalTarget(url));
  for (const url of ['https://pilot.example.test', 'http://127.0.0.1.example.test', 'http://user:secret@localhost', 'http://localhost/path', 'file:///tmp/report']) assert.throws(() => requireLocalTarget(url));
});
test('latency summaries preserve errors and nearest-rank percentiles without retaining URLs', () => {
  const samples = Array.from({ length: 100 }, (_, index) => ({ milliseconds: index + 1, status: index === 99 ? 500 : 200, expected: 200 }));
  assert.deepEqual(summarizeSamples(samples), { requests: 100, unexpected: 1, p50Ms: 50, p95Ms: 95, p99Ms: 99, statuses: { 200: 99, 500: 1 } });
  assert.throws(() => summarizeSamples([]));
});
test('budget gates fail closed for missing evidence, unexpected responses and strict p95 limits', () => {
  assert.equal(evaluateBudgets({ warm: { requests: 200, p95Ms: 49, unexpected: 0 } }, { warm: 50 }).isPassed, true);
  for (const profiles of [{}, { warm: { requests: 200, p95Ms: 50, unexpected: 0 } }, { warm: { requests: 200, p95Ms: 30, unexpected: 1 } }, { warm: { requests: 0, p95Ms: 0, unexpected: 0 } }]) {
    assert.equal(evaluateBudgets(profiles, { warm: 50 }).isPassed, false);
  }
});

test('readiness checks distinguish normal reports from the documented 503 error envelope', async () => {
  const { readinessState } = await import('./rehearsal-policy.mjs');
  const report = { required: { postgres: { isUp: false } }, optional: { mongo: { isUp: true }, redis: { isUp: true } } };
  assert.deepEqual(readinessState(report), { postgres: false, mongo: true, redis: true });
  assert.deepEqual(readinessState({ statusCode: 503, message: report }), { postgres: false, mongo: true, redis: true });
  assert.throws(() => readinessState({ statusCode: 500, message: 'Internal server error' }));
});
