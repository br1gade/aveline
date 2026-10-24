import assert from 'node:assert/strict';
import { poll } from './client.mjs';

export function imageForm() {
  const form = new FormData();
  form.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAAAoCAYAAAAIeF9DAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAt0lEQVRoge3YoRXAMAzE0GxjGKL9V0tnKJKBwPE+/ZT4DPe1u6bBsT+g3UBm8UPoD8FHCAQ/fCD4sQPBDxwIftRA8EMGgh8vEPxggeBHCgQ/TCALYsyCdTrBRwgEP3wg+LEDwQ8cCH7UQPBDBoIfLxD8YIHgRwoEP0wgC2LMgnU6wUcIBD98IPixA8EPHAh+1EDwQwaCHy8Q/GCB4EcKBD9MIAtizIJ1OsFHCAQ/fCD4sQPBD/x3H+0K/fqX/raOAAAAAElFTkSuQmCC', 'base64')], { type: 'image/png' }), 'synthetic.png');
  return form;
}
export async function checkContributions(context, client) {
  const { event, host, path, guests } = context;
  const statement = await host('POST', `/invitations/${event.invitation.slug}/questions`, { type: 'SIGNATURE', required: true, prompt: { en: 'I acknowledge the event terms', ru: 'Я принимаю условия мероприятия', fr: "J’accepte les conditions de l’événement", hy: 'Ընդունում եմ միջոցառման պայմանները' } });
  const household = guests.filter((guest) => guest.householdId === guests[0].householdId);
  const signed = await client.request('POST', `${path()}/acknowledgements`, { statementVersionId: statement.statementVersionId, subjectGuestIds: household.map(({ id }) => id), method: 'TYPED', signerName: 'Synthetic representative', isAcknowledged: true, isRepresentative: true, locale: 'en' });
  assert.equal(signed.records.length, household.length);
  const upload = await client.request('POST', `${path()}/signature-uploads`, imageForm());
  await poll(() => client.request('GET', `${path()}/acknowledgements`), (value) => value.signatureUploads.some((item) => item.id === upload.id && item.processingStatus === 'READY'), 'signature processing');
  await client.request('POST', `${path()}/acknowledgements`, { statementVersionId: statement.statementVersionId, subjectGuestIds: [guests[0].id], method: 'DRAWN', assetId: upload.id, signerName: 'Synthetic drawing', isAcknowledged: true, locale: 'en' });
  const photo = await client.request('POST', `${path()}/gallery`, imageForm());
  const gallery = await poll(() => client.request('GET', `${path()}/gallery`), (value) => value.items.some((item) => item.id === photo.id && item.processingStatus === 'READY'), 'gallery processing');
  assert.equal(gallery.items.find((item) => item.id === photo.id).moderationStatus, 'PENDING');
  const other = guests.find((guest) => guest.householdId !== guests[0].householdId);
  const hidden = await client.request('GET', `${path(other)}/gallery`);
  assert.ok(!hidden.items.some((item) => item.id === photo.id));
  await host('PATCH', `/events/${event.id}/gallery/${photo.id}`, { moderationStatus: 'APPROVED' });
  const visible = await client.request('GET', `${path(other)}/gallery`);
  assert.ok(visible.items.some((item) => item.id === photo.id));
  const file = await client.request('GET', `${path(other)}/gallery/${photo.id}/file?variant=thumbnail`, undefined, { bytes: true });
  assert.ok(file.headers.get('cache-control').includes('no-store'));
  assert.equal(file.buffer.subarray(0, 4).toString(), 'RIFF');
  assert.equal(file.buffer.subarray(8, 12).toString(), 'WEBP');
  await client.request('DELETE', `${path()}/gallery/${photo.id}`, undefined, { expected: [200, 204] });
  await client.request('GET', `${path(other)}/gallery/${photo.id}/file`, undefined, { expected: 404 });
  await checkTicketAcknowledgement(context, client, statement.statementVersionId);
  return { isTicketAcknowledgementGateTested: true, typedSubjects: signed.records.length, isDrawnProcessed: true, isApprovalEnforced: true, isOwnerRemovalEnforced: true };
}

async function checkTicketAcknowledgement(context, client, statementVersionId) {
  const prefix = `/events/${context.event.id}`;
  await context.host('POST', `${prefix}/tickets/${context.unsignedTicket.code}/admit`, {}, { expected: 400 });
  const guest = await context.host('GET', `${prefix}/guests/${context.unsignedTicketGuest.id}`);
  await client.request('POST', `${context.path(guest)}/acknowledgements`, { statementVersionId, subjectGuestIds: [guest.id], method: 'TYPED', signerName: 'Synthetic ticket attendee', isAcknowledged: true, locale: 'hy' });
  await context.host('POST', `${prefix}/tickets/${context.unsignedTicket.code}/admit`, {});
}
