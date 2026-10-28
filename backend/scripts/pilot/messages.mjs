import assert from 'node:assert/strict';

export async function checkMessages(context, environment) {
  const prefix = `/invitations/${context.event.invitation.slug}`;
  await context.host('POST', `${prefix}/send`, { guestIds: context.ticketGuests.map(({ id }) => id) });
  await environment.control('outbox');
  const waiting = await context.host('POST', `${prefix}/remind`, {});
  assert.equal(waiting.queued, 0); assert.ok(waiting.recentlyInvited > 0);
  await environment.fixture('age-invitations');
  const reminder = await context.host('POST', `${prefix}/remind`, {});
  assert.ok(reminder.queued > 0);
  const repeatedReminder = await context.host('POST', `${prefix}/remind`, {});
  assert.equal(repeatedReminder.queued, 0);
  const reminderDelivery = await environment.control('outbox');
  await context.host('PATCH', `/events/${context.event.id}`, { startsAt: new Date(Date.now() - 86400000).toISOString(), endsAt: new Date(Date.now() - 82800000).toISOString() });
  const thanks = await context.host('POST', `${prefix}/thank-you`, {});
  assert.equal(thanks.basis, 'ARRIVED'); assert.ok(thanks.queued > 0);
  const repeatedThanks = await context.host('POST', `${prefix}/thank-you`, {});
  assert.equal(repeatedThanks.queued, 0);
  const thanksDelivery = await environment.control('outbox');
  return { remindersQueued: reminder.queued, remindersSent: reminderDelivery.result.sent, thanksQueued: thanks.queued, thanksSent: thanksDelivery.result.sent, isInvitationCooldownTested: true, isReminderDedupeTested: true, isThanksDedupeTested: true, basis: thanks.basis, transport: 'local Mailpit' };
}
