import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFailures } from './ci-test-results.mjs';

test('failed assertions name the test file and preserve diagnostic text as one escaped annotation', () => {
  const results = { testResults: [{ name: '/repo/backend/test/example.int-spec.ts', status: 'failed', message: '\u001b[31mExpected: 2\nReceived: 3%\r\n::warning::synthetic\u001b[0m' }] };
  assert.deepEqual(formatFailures(results, '/repo'), ['::error file=backend/test/example.int-spec.ts::Expected: 2%0AReceived: 3%25%0D%0A::warning::synthetic']);
});

test('successful and skipped suites do not emit failures; diagnostics are bounded', () => {
  assert.deepEqual(formatFailures({ testResults: [{ name: '/repo/a', status: 'passed' }, { name: '/repo/b', status: 'pending' }] }, '/repo'), []);
  const lines = formatFailures({ testResults: [{ name: '/repo/bad', status: 'failed', message: 'x'.repeat(20000) }] }, '/repo');
  assert.ok(lines[0].length < 6500);
});
