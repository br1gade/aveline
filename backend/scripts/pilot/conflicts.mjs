import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { poll } from './client.mjs';
import { imageForm } from './contributions.mjs';

export async function checkManualSeatingConflict(context, environment) {
  const base = `/events/${context.event.id}`;
  const arrangements = await context.host('GET', `${base}/seating/arrangements`);
  const arrangement = arrangements.find((item) => item.venueId === context.venues[0].id);
  const tables = await context.host('GET', `${base}/tables?arrangementId=${arrangement.id}`);
  const from = tables.find((table) => table.guests.length > 0);
  assert.ok(from, 'Fixture must provide a seated guest');
  const to = tables.find((table) => table.id !== from.id && table.guests.length < table.capacity);
  assert.ok(from && to, 'Fixture must provide a seated guest and spare place');
  const guestId = from.guests[0].guestId;
  await environment.interrupt('stop', 'seating-worker');
  const job = await context.host('POST', `${base}/seats/auto-assign?arrangementId=${arrangement.id}`, { idempotencyKey: randomUUID() });
  await environment.save('seating-plan-fence', { isHeld: true });
  await environment.interrupt('start', 'seating-worker');
  const path = `${base}/seating/jobs/${job.id}`;
  await poll(() => environment.read('seating-plan-held').catch(() => null), (value) => value?.isHeld, 'computed seating plan before apply');
  await context.host('POST', `${base}/seats`, { guestId, tableId: to.id });
  await environment.save('seating-plan-fence', { isHeld: false });
  const completed = await poll(() => context.host('GET', path), (value) => ['COMPLETED', 'FAILED'].includes(value.status), 'replanned seating');
  assert.equal(completed.status, 'COMPLETED'); assert.ok(completed.attempts >= 2);
  const current = await context.host('GET', `${base}/tables?arrangementId=${arrangement.id}`);
  assert.ok(current.find((table) => table.id === to.id).guests.some((guest) => guest.guestId === guestId), 'Manual change must survive replanning');
  assert.ok(current.every((table) => table.guests.length <= table.capacity));
  return { status: completed.status, attempts: completed.attempts, fence: 'rehearsal-only pause after planning, before apply locks', isManualSeatPreserved: true, isCapacityRespected: true };
}

export async function checkImageWorkerLease(context, client, environment) {
  await environment.interrupt('stop', 'private-media-worker');
  const path = `${context.path(context.guests[0])}/gallery`;
  const uploaded = await client.request('POST', path, imageForm());
  await environment.save('image-job', { id: uploaded.id });
  await environment.fixture('hold-image');
  await environment.interrupt('start', 'private-media-worker');
  const image = async () => (await client.request('GET', path)).items.find((item) => item.id === uploaded.id);
  await poll(image, (value) => value?.processingStatus === 'PROCESSING', 'in-flight image processing');
  await environment.interrupt('kill', 'private-media-worker');
  await environment.fixture('release-image');
  const started = performance.now();
  await environment.interrupt('start', 'private-media-worker');
  await poll(image, (value) => ['READY', 'FAILED'].includes(value?.processingStatus), 'real 120-second image lease', { timeoutMs: 150000, intervalMs: 2000 });
  await environment.fixture('image-recovery-report');
  const report = await environment.read('image-recovery-report');
  assert.equal(report.status, 'READY'); assert.equal(report.attempts, 2); assert.equal(report.objects, 3);
  assert.ok(report.isLeaseCleared && report.isQuotaReconciled);
  return { ...report, isInFlightKillTested: true, isActualLeaseClockUsed: true, leaseMs: 120000, recoveryMs: performance.now() - started };
}
