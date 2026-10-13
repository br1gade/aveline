import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBackup } from './check-backup.mjs';

const now = Date.parse('2026-10-13T12:00:00Z');
const fresh = { runId: 'pilot-1', completedAt: '2026-10-13T03:00:00Z' };
const space = { blocks: 1000n, bavail: 200n, bsize: 1048576n };
const settings = { now, maxAgeHours: 30, minFreeBytes: 100 * 1048576, maxUsedPercent: 90 };
test('refuses missing or stale off-host success, including a future clock', () => {
  for (const marker of [null, {}, { ...fresh, completedAt: '2026-10-11T03:00:00Z' }, { ...fresh, completedAt: '2026-10-14T03:00:00Z' }]) {
    assert.equal(assessBackup(marker, space, settings).isHealthy, false);
  }
});
test('requires both free bytes and percentage headroom', () => {
  assert.equal(assessBackup(fresh, space, settings).isHealthy, true);
  assert.equal(assessBackup(fresh, { ...space, bavail: 99n }, settings).isHealthy, false);
  assert.equal(assessBackup(fresh, { ...space, blocks: 10000n }, settings).isHealthy, false);
});
