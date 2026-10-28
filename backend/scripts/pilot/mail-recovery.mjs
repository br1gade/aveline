import assert from 'node:assert/strict';
import { poll } from './client.mjs';

export async function checkMailAndStorage(context, environment, exports) {
  await environment.privateStorageMode('000');
  try {
    await context.host('GET', `/events/${context.event.id}/export-snapshots/${exports.firstId}/download`, undefined, { expected: 503 });
    await context.host('GET', `/events/${context.event.id}/dashboard`);
  } finally { await environment.privateStorageMode('700'); }
  await context.host('GET', `/events/${context.event.id}/export-snapshots/${exports.firstId}/download`, undefined, { bytes: true });
  await environment.interrupt('stop', 'mailpit');
  await context.host('POST', `/invitations/${context.event.invitation.slug}/send`, { guestIds: [context.guests[0].id] });
  const failed = await environment.control('outbox');
  assert.ok(failed.result.retrying > 0, 'SMTP outage must retain a retryable message');
  await environment.interrupt('start', 'mailpit');
  // Advance only fixture retries; this is not a real-clock backoff acceptance.
  await environment.fixture('mail-due');
  const recovered = await poll(() => environment.control('outbox'), (value) => value.result.sent > 0, 'SMTP recovery');
  await environment.fixture('outbox-report');
  return { isStorageOutageRecoverable: true, retryingDuringSmtpOutage: failed.result.retrying, sentAfterRecovery: recovered.result.sent, statuses: await environment.read('outbox'), isRealProviderTested: false };
}
