import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTraceSummary } from './trace-summary.mjs';

test('local trace evidence stores only bounded connection timing, never SQL or identifiers', () => {
  const summary = createTraceSummary(3);
  for (let index = 0; index < 5; index++) summary.onEnd({ name: 'prisma:engine:connection', duration: [0, index * 1000000], attributes: { 'db.statement': 'private query', email: 'private@example.test' } });
  summary.onEnd({ name: 'prisma:engine:db_query', duration: [1, 0], attributes: { 'db.statement': 'private query' } });
  const report = summary.snapshot();
  assert.equal(report.connectionAcquisitions, 5); assert.equal(report.totalMs, 10);
  assert.equal(report.maxMs, 4); assert.equal(report.sampled, 3);
  assert.ok(!JSON.stringify(report).includes('private'));
});
test('missing pool tracing is reported as unavailable rather than a zero-wait success', () => {
  assert.equal(createTraceSummary().snapshot().isAvailable, false);
});
