import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { poll } from './client.mjs';

export async function checkWorkerLeases(context, environment) {
  const { host, event } = context;
  const exports = `/events/${event.id}/export-snapshots`;
  const seating = `/events/${event.id}/seating/jobs`;
  await environment.interrupt('stop', 'export-worker');
  await environment.interrupt('stop', 'seating-worker');
  const arrangements = await host('GET', `/events/${event.id}/seating/arrangements`);
  const arrangement = arrangements.find((item) => item.venueId);
  const exported = await host('POST', exports, { kind: 'GUEST_LIST', format: 'CSV', idempotencyKey: randomUUID() });
  const seated = await host('POST', `/events/${event.id}/seats/auto-assign?arrangementId=${arrangement.id}`, { idempotencyKey: randomUUID() });
  // Lock only this disposable database's standing/privacy fences so actual
  // workers are observable in RUNNING before their capture can finish.
  await environment.holdWorkers();
  await poll(() => environment.read('workers-held').catch(() => null), (value) => value?.isHeld, 'worker capture fence');
  await environment.interrupt('start', 'export-worker');
  await environment.interrupt('start', 'seating-worker');
  const paths = [`${exports}/${exported.id}`, `${seating}/${seated.id}`];
  for (const path of paths) await poll(() => host('GET', path), (value) => value.status === 'RUNNING', 'running worker', { timeoutMs: 15000 });
  await environment.interrupt('kill', 'export-worker');
  await environment.interrupt('kill', 'seating-worker');
  await environment.interrupt('kill', 'lease-lock');
  const started = performance.now();
  await environment.interrupt('start', 'export-worker');
  await environment.interrupt('start', 'seating-worker');
  const results = [];
  for (const path of paths) {
    const result = await poll(() => host('GET', path), (value) => ['COMPLETED', 'FAILED'].includes(value.status), 'real 90-second lease expiry', { timeoutMs: 120000, intervalMs: 2000 });
    assert.equal(result.status, 'COMPLETED'); assert.equal(result.attempts, 2);
    results.push({ status: result.status, attempts: result.attempts });
  }
  return { isInFlightKillTested: true, isActualLeaseClockUsed: true, leaseMs: 90000, recoveryMs: performance.now() - started, jobs: results };
}
