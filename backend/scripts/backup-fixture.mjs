// Synthetic recovery data only; never run against an operator database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { imageForm } from './pilot/contributions.mjs';
const require = createRequire(import.meta.url);
const { PrismaClient, ExportKind, ExportFormat } = require('@prisma/client');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { ConfigService } = require('@nestjs/config');
const { renderPrivateImage } = require('../dist/modules/guest-contributions/private-media-runner.js');
const { renderExport } = require('../dist/modules/exports/renderers/render-export.js');
const { ExportSheets } = require('../dist/modules/exports/export-sheets.js');
const { OperationsService } = require('../dist/modules/operations/operations.service.js');
const sharp = require('sharp');
if (new URL(process.env.DATABASE_URL).pathname !== '/aveline_recovery_test') throw new Error('Disposable recovery database required');
const prisma = new PrismaClient();
const storage = new S3Client({ endpoint: process.env.ENDPOINT, region: 'garage', forcePathStyle: true,
  credentials: { accessKeyId: process.env.ACCESS_KEY, secretAccessKey: process.env.SECRET_KEY } });
const state = process.env.RECOVERY_STATE_ROOT;
const manifestFile = join(state, 'manifest.json');
const objects = [];
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex');
let fixtureStage = 'start';
try {
  if (process.argv[2] === 'seed') await seed();
  else if (process.argv[2] === 'verify') await verify();
  else throw new Error('Unknown recovery action');
} catch (error) {
  const unknownField = /(?:Unknown argument|Argument) `([a-zA-Z]+)`/.exec(error.message)?.[1];
  console.error(`Recovery fixture invariant failed (${fixtureStage}, ${error.name}, ${error.code ?? 'no-code'}, field ${unknownField ?? 'withheld'}); private state withheld`);
  process.exitCode = 1;
}
finally { await prisma.$disconnect(); storage.destroy(); }

async function put(bucket, key, bytes, type) {
  await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: type }));
  objects.push({ bucket, key, hash: fingerprint(bytes), bytes: bytes.length });
}

async function seed() {
  const context = await seedPeople();
  await seedTickets(context);
  const media = await seedMedia(context);
  await seedAcknowledgements(context, media);
  const exports = await seedExports(context);
  const revisions = await prisma.seatingArrangement.findMany({ where: { eventId: context.event.id }, select: { id: true, revision: true } });
  const payloadRevisions = await readPayloadRevisions(context.event.id);
  const manifest = { ...context, media, exports, revisions, payloadRevisions, objects };
  await writeFile(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
}

async function seedPeople() {
  fixtureStage = 'people';
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: 'Synthetic 400-person recovery', kind: 'HOST' } });
    const owner = await tx.user.create({ data: { email: `${randomUUID()}@example.test`, name: 'Recovery owner' } });
    const event = await tx.event.create({ data: { organizationId: organization.id, type: 'WEDDING', title: 'Recovery – Վերականգնում', hostsLabel: 'Synthetic hosts',
      startsAt: new Date(Date.now() + 86400000), status: 'PUBLISHED', seatingPublishedAt: new Date(), attendanceMode: 'PER_VENUE', locales: ['en', 'ru', 'fr', 'hy'], defaultLocale: 'en',
      memberships: { create: { userId: owner.id, role: 'OWNER' } } } });
    const template = await tx.designTemplate.create({ data: { key: 'recovery', name: 'Recovery', allowedFonts: ['Inter'], supportedBlocks: ['HERO', 'RSVP'] } });
    const invitation = await tx.invitation.create({ data: { eventId: event.id, templateId: template.id, slug: `recovery-${randomUUID()}`, status: 'PUBLISHED',
      blocks: { create: [{ type: 'HERO', sortOrder: 0, content: { en: { title: 'Recovery' }, ru: { title: 'Восстановление' }, fr: { title: 'Restauration' }, hy: { title: 'Վերականգնում' } } }] } } });
    const venues = [0, 1].map((index) => ({ id: randomUUID(), eventId: event.id, name: `Venue ${index + 1}`, role: 'RECEPTION', address: 'Synthetic address', capacity: 400, sortOrder: index }));
    await tx.venue.createMany({ data: venues });
    const households = Array.from({ length: 100 }, (_, index) => ({ id: randomUUID(), eventId: event.id, name: `Household ${index}`, seatsAllotted: 4 }));
    await tx.household.createMany({ data: households });
    const guests = Array.from({ length: 400 }, (_, index) => ({ id: randomUUID(), eventId: event.id, householdId: households[Math.floor(index / 4)].id,
      firstName: ['Անի', 'Иван', 'Émilie', 'Alex'][index % 4], lastName: `Synthetic ${index}`, token: randomUUID(), email: `person-${index}@example.test`, locale: ['en', 'ru', 'fr', 'hy'][index % 4], isPrimary: index % 4 === 0 }));
    await tx.guest.createMany({ data: guests });
    await tx.rsvp.createMany({ data: guests.map((guest, index) => ({ guestId: guest.id, status: index < 320 ? 'ATTENDING' : index < 360 ? 'DECLINED' : 'PENDING', respondedAt: index < 360 ? new Date() : null, dietary: index % 3 === 0 ? ['Vegetarian'] : [], dietaryNotes: index % 9 === 0 ? 'Synthetic allergy note' : null })) });
    await tx.attendanceResponse.createMany({ data: guests.flatMap((guest, index) => venues.map((venue, venueIndex) => ({ eventId: event.id, guestId: guest.id, venueId: venue.id, scopeId: venue.id, revision: 1,
      status: index < (venueIndex ? 240 : 320) ? 'ATTENDING' : index < 360 ? 'DECLINED' : 'PENDING', respondedAt: index < 360 ? new Date() : null }))) });
    const tables = venues.flatMap((venue) => Array.from({ length: 50 }, (_, index) => ({ id: randomUUID(), eventId: event.id, venueId: venue.id, arrangementId: `venue:${venue.id}`, name: `Table ${index}`, capacity: 8 })));
    await tx.table.createMany({ data: tables });
    await tx.seat.createMany({ data: venues.flatMap((venue, venueIndex) => guests.slice(0, venueIndex ? 240 : 320).map((guest, index) => ({ guestId: guest.id, arrangementId: `venue:${venue.id}`, tableId: tables[venueIndex * 50 + Math.floor(index / 8)].id, position: index % 8 + 1 }))) });
    return { event: { id: event.id }, ownerId: owner.id, slug: invitation.slug, invitationId: invitation.id, guests, venues };
  }, { timeout: 60000 });
}

async function seedTickets(context) {
  fixtureStage = 'tickets';
  const eventId = context.event.id;
  const type = await prisma.ticketType.create({ data: { eventId, name: { en: 'Pilot admission' }, priceMinor: 0n, quantityTotal: 40, quantitySold: 40 } });
  for (let group = 0; group < 4; group++) {
    await prisma.$transaction(async (tx) => {
      const order = await tx.ticketOrder.create({ data: { eventId, buyerName: 'Synthetic buyer', buyerEmail: `buyer-${group}@example.test`, status: 'PAID', totalMinor: 0n, idempotencyKey: randomUUID(), accessToken: randomUUID() } });
      const attendees = context.guests.slice(group * 10, group * 10 + 10).map((guest, position) => ({ id: randomUUID(), eventId, orderId: order.id, ticketTypeId: type.id, position,
        firstName: guest.firstName, lastName: guest.lastName, email: guest.email, locale: guest.locale, attendanceRevision: 1, status: 'ATTENDING', generatedGuestId: guest.id,
        venueAttendance: context.venues.map((venue) => ({ venueId: venue.id, status: 'ATTENDING' })) }));
      await tx.orderAttendee.createMany({ data: attendees });
      await tx.ticket.createMany({ data: attendees.map((attendee) => ({ eventId, orderId: order.id, ticketTypeId: type.id, attendeeId: attendee.id, guestId: attendee.generatedGuestId, code: randomUUID(), holderName: `${attendee.firstName} ${attendee.lastName}`, holderEmail: attendee.email })) });
    });
  }
}

async function seedMedia(context) {
  fixtureStage = 'media';
  const gallery = [];
  for (let index = 0; index < 40; index++) {
    // Unique, valid full-size raster payloads exercise capture/restore volume,
    // rather than letting block deduplication collapse 40 identical tiny files.
    const pixels = await promisify(randomBytes)(1280 * 720 * 3);
    const source = await sharp(pixels, { raw: { width: 1280, height: 720, channels: 3 } }).png().toBuffer();
    const rendered = await renderPrivateImage(source, 'GALLERY');
    const original = randomUUID(); const variant = randomUUID();
    await put('rehearsal-media', original, source, 'image/png');
    await put('rehearsal-media', variant, rendered.thumbnail, 'image/webp');
    await prisma.mediaAsset.create({ data: { eventId: context.event.id, kind: 'PHOTO', url: `https://media.example.test/${original}`, sizeBytes: source.length,
      variants: [{ url: `https://media.example.test/${variant}`, width: 480, height: 270, sizeBytes: rendered.thumbnail.length }] } });
    const keys = [randomUUID(), randomUUID(), randomUUID()];
    await put('rehearsal-private', keys[0], source, 'image/png'); await put('rehearsal-private', keys[1], rendered.display, 'image/webp'); await put('rehearsal-private', keys[2], rendered.thumbnail, 'image/webp');
    gallery.push(await prisma.guestMedia.create({ data: { eventId: context.event.id, uploaderGuestId: context.guests[index].id, kind: 'GALLERY', processingStatus: 'READY', moderationStatus: index % 2 ? 'PENDING' : 'APPROVED',
      sourceKey: keys[0], displayKey: keys[1], thumbnailKey: keys[2], mimeType: 'image/png', sourceBytes: source.length, storedBytes: source.length + rendered.display.length + rendered.thumbnail.length,
      reservedBytes: source.length + rendered.display.length + rendered.thumbnail.length, width: rendered.width, height: rendered.height, attempts: 1 } }));
  }
  const signatures = await seedSignatureMedia(context, Buffer.from(await imageForm().get('file').arrayBuffer()));
  return { gallery: gallery.map(({ id, uploaderGuestId, moderationStatus }) => ({ id, uploaderGuestId, moderationStatus })), signatures };
}

async function seedSignatureMedia(context, source) {
  fixtureStage = 'signatures';
  const rendered = await renderPrivateImage(source, 'SIGNATURE');
  const signatures = [];
  for (let index = 0; index < 4; index++) {
    const sourceKey = randomUUID(); const displayKey = randomUUID();
    await put('rehearsal-private', sourceKey, source, 'image/png'); await put('rehearsal-private', displayKey, rendered.display, 'image/png');
    signatures.push(await prisma.guestMedia.create({ data: { eventId: context.event.id, uploaderGuestId: context.guests[index * 4].id, kind: 'SIGNATURE',
      processingStatus: 'READY', sourceKey, displayKey, mimeType: 'image/png', sourceBytes: source.length,
      storedBytes: source.length + rendered.display.length, reservedBytes: source.length + rendered.display.length,
      width: rendered.width, height: rendered.height, attempts: 1 } }));
  }
  return signatures.map(({ id, uploaderGuestId }) => ({ id, uploaderGuestId }));
}

async function seedAcknowledgements(context, media) {
  fixtureStage = 'acknowledgements';
  const question = await prisma.rsvpQuestion.create({ data: { invitationId: context.invitationId, type: 'SIGNATURE', required: true, prompt: { en: 'Synthetic terms' } } });
  const statement = await prisma.questionStatement.create({ data: { questionId: question.id, revision: 1, prompt: { en: 'Synthetic terms' } } });
  await prisma.rsvpQuestion.update({ where: { id: question.id }, data: { statementVersionId: statement.id } });
  await prisma.guestAcknowledgement.createMany({ data: context.guests.map((guest, index) => ({ dedupeKey: randomUUID(), eventId: context.event.id, questionId: question.id,
    statementVersionId: statement.id, subjectGuestId: guest.id, signerGuestId: context.guests[Math.floor(index / 4) * 4].id, signerName: 'Synthetic representative',
    method: index < 16 && index % 4 === 0 ? 'DRAWN' : 'TYPED', mediaId: index < 16 && index % 4 === 0 ? media.signatures[index / 4].id : null,
    isRepresentative: index % 4 !== 0, locale: 'en', statement: 'Synthetic terms' })) });
}

async function seedExports(context) {
  fixtureStage = 'exports';
  const exports = [];
  for (const kind of Object.values(ExportKind)) for (const format of Object.values(ExportFormat)) {
    const key = randomUUID(); const snapshotAt = new Date(); const expiresAt = new Date(Date.now() + 86400000);
    const sheet = await new ExportSheets(prisma, new OperationsService(prisma, {}), 'hy').buildSnapshot(context.event.id, kind);
    const file = await renderExport({ kind, format, locale: 'hy', title: 'Recovery', snapshotAt, timezone: 'Asia/Yerevan', attendanceRevision: 1, dataRevision: 'recovery', includesContacts: true, sheet });
    await put('rehearsal-private', key, file.buffer, file.mimeType);
    const snapshot = await prisma.exportSnapshot.create({ data: { eventId: context.event.id, requestedByUserId: context.ownerId, idempotencyKey: randomUUID(), kind, format, locale: 'hy', includesContacts: true,
      status: 'COMPLETED', attempts: 1, snapshotAt, timezone: 'Asia/Yerevan', attendanceRevision: 1, dataRevision: 'recovery', artifactKey: key, expiresAt, completedAt: snapshotAt,
      artifacts: { create: { key, cleanupAfter: expiresAt } }, subjects: { create: context.guests.map((guest) => ({ fingerprint: fingerprint(guest.email) })) } } });
    exports.push({ id: snapshot.id, key, hash: fingerprint(file.buffer) });
  }
  return exports;
}

async function verify() {
  fixtureStage = 'verify';
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const counts = await verifyDomain(manifest);
  for (const object of manifest.objects) {
    const response = await storage.send(new GetObjectCommand({ Bucket: object.bucket, Key: object.key }));
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    assert.equal(bytes.length, object.bytes); assert.equal(fingerprint(bytes), object.hash);
  }
  for (const bucket of ['rehearsal-media', 'rehearsal-private']) {
    const list = await storage.send(new ListObjectsV2Command({ Bucket: bucket }));
    assert.equal(list.IsTruncated, false); assert.equal(list.KeyCount, manifest.objects.filter((object) => object.bucket === bucket).length);
  }
  await verifyAccess(manifest);
  await writeFile(join(state, 'verified.json'), JSON.stringify({ ...counts, objects: manifest.objects.length,
    objectBytes: manifest.objects.reduce((sum, item) => sum + item.bytes, 0), isByteHashesVerified: true, isPrivateAccessVerified: true,
    isSnapshotDownloadVerified: true, isInvitationCapabilityVerified: true, isPayloadRevisionsVerified: true }), { mode: 0o644 });
}

async function verifyDomain(manifest) {
  const counts = { people: await prisma.guest.count(), households: await prisma.household.count(), venues: await prisma.venue.count(),
    tables: await prisma.table.count(), seats: await prisma.seat.count(), rsvps: await prisma.rsvp.count(), venueAnswers: await prisma.attendanceResponse.count(),
    tickets: await prisma.ticket.count(), attendees: await prisma.orderAttendee.count(), acknowledgements: await prisma.guestAcknowledgement.count(),
    galleryImages: await prisma.guestMedia.count({ where: { kind: 'GALLERY' } }), signatureImages: await prisma.guestMedia.count({ where: { kind: 'SIGNATURE' } }),
    publicImages: await prisma.mediaAsset.count(), snapshots: await prisma.exportSnapshot.count(), snapshotSubjects: await prisma.exportSnapshotSubject.count() };
  assert.deepEqual(counts, { people: 400, households: 100, venues: 2, tables: 100, seats: 560, rsvps: 400, venueAnswers: 800, tickets: 40, attendees: 40, acknowledgements: 400, galleryImages: 40, signatureImages: 4, publicImages: 40, snapshots: 21, snapshotSubjects: 8400 });
  for (const revision of manifest.revisions) assert.equal((await prisma.seatingArrangement.findUniqueOrThrow({ where: { id: revision.id } })).revision, revision.revision);
  for (const guest of manifest.guests) assert.equal((await prisma.guest.findUniqueOrThrow({ where: { token: guest.token } })).id, guest.id);
  assert.deepEqual(await readPayloadRevisions(manifest.event.id), manifest.payloadRevisions);
  return counts;
}

async function verifyAccess(manifest) {
  const { buildPrivateStorage, PrivateStorageService } = require('../dist/infra/storage/private/private-storage.js');
  const { GuestMediaService } = require('../dist/modules/guest-contributions/guest-media.service.js');
  const { ExportSnapshotsService } = require('../dist/modules/exports/export-snapshots.service.js');
  const { InvitationsService } = require('../dist/modules/invitations/invitations.service.js');
  const { CacheService } = require('../dist/infra/cache/cache.service.js');
  const cache = new CacheService({ get: () => Promise.resolve(null), set: () => Promise.resolve('OK') });
  const invitations = new InvitationsService(prisma, cache, { recordInvitationView: () => Promise.resolve() }, new ConfigService({}));
  for (const locale of ['en', 'ru', 'fr', 'hy']) {
    const page = await invitations.getPublicInvitation(manifest.slug, manifest.guests[0].token, locale);
    assert.equal(page.locale, locale); assert.equal(page.guest.id, manifest.guests[0].id);
    assert.equal(page.guest.household.members.length, 4); assert.equal(page.guest.seating.assignments.length, 2);
  }
  const privateStorage = new PrivateStorageService(buildPrivateStorage(new ConfigService({ NODE_ENV: 'production', S3_ENDPOINT: process.env.ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.ACCESS_KEY, S3_SECRET_ACCESS_KEY: process.env.SECRET_KEY, S3_BUCKET: 'rehearsal-media', PRIVATE_S3_BUCKET: 'rehearsal-private' })));
  const guestMedia = new GuestMediaService(prisma, privateStorage);
  const link = { slug: manifest.slug, token: manifest.guests[399].token };
  const approved = manifest.media.gallery.find((image) => image.moderationStatus === 'APPROVED');
  const pending = manifest.media.gallery.find((image) => image.moderationStatus === 'PENDING');
  await guestMedia.readGuest(link, approved.id, { kind: 'GALLERY', variant: 'display' });
  await assert.rejects(() => guestMedia.readGuest(link, pending.id, { kind: 'GALLERY', variant: 'display' }));
  const anonymous = await fetch(`${process.env.ENDPOINT}/rehearsal-private/${manifest.exports[0].key}`);
  assert.equal(anonymous.status, 403); await anonymous.arrayBuffer();
  const drawing = manifest.media.signatures[0];
  const acknowledgement = await prisma.guestAcknowledgement.findFirstOrThrow({ where: { mediaId: drawing.id } });
  await guestMedia.readGuest({ slug: manifest.slug, token: manifest.guests[0].token }, drawing.id, { kind: 'SIGNATURE', variant: 'display', acknowledgementId: acknowledgement.id });
  await assert.rejects(() => guestMedia.readGuest(link, drawing.id, { kind: 'SIGNATURE', variant: 'display', acknowledgementId: acknowledgement.id }));
  const snapshots = new ExportSnapshotsService(prisma, privateStorage);
  const restored = await snapshots.download(manifest.event.id, manifest.exports[0].id, manifest.ownerId);
  assert.equal(fingerprint(restored.buffer), manifest.exports[0].hash);
  const outsider = await prisma.user.create({ data: { name: 'No membership', email: `${randomUUID()}@example.test` } });
  await assert.rejects(() => snapshots.download(manifest.event.id, manifest.exports[0].id, outsider.id));
}

function readPayloadRevisions(eventId) {
  return prisma.$queryRaw`SELECT scope, guest_payload_revision(${eventId}, scope)::text AS revision FROM (
    SELECT 'shared' AS scope UNION SELECT 'household:' || id FROM households WHERE "eventId" = ${eventId}
  ) scopes ORDER BY scope`;
}
