import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { poll } from './client.mjs';
import { readinessState } from './rehearsal-policy.mjs';

export async function checkRecovery(context, client, environment) {
  const cases = [];
  for (const service of ['mongo', 'postgres']) {
    await environment.interrupt('stop', service);
    const status = service === 'postgres' ? 503 : 200;
    const down = readinessState(await client.request('GET', '/health/ready', undefined, { expected: status }));
    assert.equal(down[service], false);
    if (service === 'mongo') await client.request('GET', context.path());
    await environment.interrupt('start', service);
    await poll(() => client.request('GET', '/health/ready', undefined, { expected: [200, 503] }).then(readinessState), (value) => value[service], `${service} recovery`);
    await client.request('GET', context.path());
    cases.push({ service, outageStatus: status, didRecoverWithoutApiRestart: true });
  }
  await environment.interrupt('kill', 'export-worker');
  const prefix = `/events/${context.event.id}/export-snapshots`;
  const queued = await context.host('POST', prefix, { kind: 'GUEST_LIST', format: 'CSV', idempotencyKey: randomUUID() });
  await pause(2200);
  const waiting = await context.host('GET', `${prefix}/${queued.id}`);
  assert.equal(waiting.status, 'QUEUED');
  await environment.interrupt('start', 'export-worker');
  const finished = await poll(() => context.host('GET', `${prefix}/${queued.id}`), (value) => ['COMPLETED', 'FAILED'].includes(value.status), 'export restart');
  assert.equal(finished.status, 'COMPLETED');
  cases.push({ service: 'export-worker', isQueuedRequestPreservedAcrossRestart: true, isInFlightLeaseRecoveryTested: false });
  await environment.interrupt('restart', 'api');
  await poll(() => client.request('GET', '/health/ready').then(() => true).catch(() => false), Boolean, 'API redeploy');
  const households = await context.host('GET', `/events/${context.event.id}/guests`);
  assert.ok(households.flatMap((item) => item.guests).length >= 400);
  cases.push({ service: 'api', isCommittedDataPreservedAfterRestart: true });
  return cases;
}
