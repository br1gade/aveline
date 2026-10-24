import sharp from 'sharp';
import { SerializeInterceptor } from '../../src/common/interceptors/serialize';
import { PrivateMediaRunner } from '../../src/modules/guest-contributions/private-media-runner';
import { PrivateStorageService } from '../../src/infra/storage/private/private-storage';
import { ticketEvent } from '../fixtures/tickets.fixture';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { buildPrivateStorage, PRIVATE_STORAGE } from '../../src/infra/storage/private/private-storage';
import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Acknowledgements and gallery (HTTP)', () => {
  let prisma: PrismaClient; let app: INestApplication; let root: string;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-guest-private-http-'));
    const storage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(PRIVATE_STORAGE).useValue(storage).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); await disconnectTestDatabase(); });
  const setup = async () => {
    const event = await seedEvent(prisma);
    const auth = await authenticateAs(app, prisma, { eventId: event.eventId });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    return { ...event, ...auth, guest, base: `/api/v1/invitations/${event.slug}/g/${event.primaryGuestToken}` };
  };
  const question = async (event: Awaited<ReturnType<typeof setup>>) => {
    const { body } = await http().post(`/api/v1/invitations/${event.slug}/questions`).set('Authorization', event.authorization)
      .send({ type: 'SIGNATURE', prompt: { en: 'I acknowledge the venue rules.' }, required: true }).expect(201);
    return body as { id: string; statementVersionId: string };
  };
  const typed = (version: string, subject: string) => ({ statementVersionId: version, subjectGuestIds: [subject], method: 'TYPED', signerName: 'Primary Guest', isAcknowledged: true, locale: 'en' });

  it('records the signer and statement separately from attendance and gates check-in', async () => {
    const event = await setup(); const statement = await question(event);
    await http().post(`/api/v1/events/${event.eventId}/guests/${event.guest.id}/check-in`).set('Authorization', event.authorization).expect(400);
    const { body } = await http().post(`${event.base}/acknowledgements`).send(typed(statement.statementVersionId, event.guest.id)).expect(201);
    expect(body.records[0]).toMatchObject({ questionId: statement.id, subjectGuestId: event.guest.id, signerGuestId: event.guest.id,
      signerName: 'Primary Guest', method: 'TYPED', locale: 'en', statement: 'I acknowledge the venue rules.' });
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('PENDING');
    await http().post(`/api/v1/events/${event.eventId}/guests/${event.guest.id}/check-in`).set('Authorization', event.authorization).expect(201);
  });
  it('requires an explicit declaration for representation and refuses foreign subjects', async () => {
    const event = await setup(); const statement = await question(event);
    const member = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Member', token: 'member-link' } });
    const other = await seedEvent(prisma); const foreign = await prisma.guest.findUniqueOrThrow({ where: { token: other.primaryGuestToken } });
    await http().post(`${event.base}/acknowledgements`).send(typed(statement.statementVersionId, member.id)).expect(400);
    await http().post(`${event.base}/acknowledgements`).send({ ...typed(statement.statementVersionId, foreign.id), isRepresentative: true }).expect(400);
    const { body } = await http().post(`${event.base}/acknowledgements`).send({ ...typed(statement.statementVersionId, member.id), isRepresentative: true }).expect(201);
    expect(body.records[0]).toMatchObject({ signerGuestId: event.guest.id, subjectGuestId: member.id, isRepresentative: true });
  });
  it('retains historical wording and invalidates a required acknowledgement after editing', async () => {
    const event = await setup(); const statement = await question(event);
    await http().post(`${event.base}/acknowledgements`).send(typed(statement.statementVersionId, event.guest.id)).expect(201);
    const change = await http().patch(`/api/v1/invitations/${event.slug}/questions/${statement.id}`).set('Authorization', event.authorization)
      .send({ prompt: { en: 'Revised rules' } }).expect(200);
    expect(change.body.statementVersionId).not.toBe(statement.statementVersionId);
    await http().post(`${event.base}/rsvp`).send({ status: 'ATTENDING' }).expect(400);
    const history = await http().get(`${event.base}/acknowledgements`).expect(200);
    expect(history.body.records[0].statement).toBe('I acknowledge the venue rules.');
    await http().post(`${event.base}/acknowledgements`).send(typed(statement.statementVersionId, event.guest.id)).expect(409);
  });
  it('preserves increasing statement versions across unanswered question type changes', async () => {
    const event = await setup(); const original = await question(event);
    const route = `/api/v1/invitations/${event.slug}/questions/${original.id}`;
    await http().patch(route).set('Authorization', event.authorization).send({ type: 'TEXT' }).expect(200);
    const restored = await http().patch(route).set('Authorization', event.authorization).send({ type: 'SIGNATURE' }).expect(200);
    expect(restored.body.statementVersionId).not.toBe(original.statementVersionId);
    expect((await prisma.questionStatement.findMany({ where: { questionId: original.id }, orderBy: { revision: 'asc' } })).map((version) => version.revision)).toEqual([1, 2]);
  });
  it('denies designers access to signatures and moderation', async () => {
    const event = await setup(); const designer = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'DESIGNER' });
    await http().get(`/api/v1/events/${event.eventId}/acknowledgements`).set('Authorization', designer.authorization).expect(403);
    await http().get(`/api/v1/events/${event.eventId}/gallery`).set('Authorization', designer.authorization).expect(403);
  });
  it.each(['acknowledgements', 'gallery'])('checks capability, publication and expiry for %s', async (path) => {
    const event = await setup();
    await http().get(`/api/v1/invitations/${event.slug}/g/invalid/${path}`).expect(404);
    await prisma.invitation.update({ where: { slug: event.slug }, data: { status: 'DRAFT' } });
    await http().get(`${event.base}/${path}`).expect(404);
    await prisma.invitation.update({ where: { slug: event.slug }, data: { status: 'PUBLISHED', expiresAt: new Date(0) } });
    await http().get(`${event.base}/${path}`).expect(404);
  });
  it('stages gallery files privately, shows only own pending items and permits owner removal', async () => {
    const event = await setup();
    const { body } = await http().post(`${event.base}/gallery`).attach('file', Buffer.from('invalid-photo'), { filename: 'x.png', contentType: 'image/png' }).expect(201);
    expect(body).toMatchObject({ kind: 'GALLERY', processingStatus: 'QUEUED', moderationStatus: 'PENDING' });
    expect(JSON.stringify(body)).not.toMatch(/sourceKey|displayKey|https?:|originalName/);
    expect((await http().get(`${event.base}/gallery`).expect(200)).body.items).toHaveLength(1);
    await http().delete(`${event.base}/gallery/${body.id}`).expect(200);
    expect((await http().get(`${event.base}/gallery`).expect(200)).body.items).toEqual([]);
  });
  it('refuses SVG and attempts to override the private gallery kind', async () => {
    const event = await setup();
    await http().post(`${event.base}/gallery`).attach('file', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(415);
    await http().post(`${event.base}/gallery`).field('kind', 'PHOTO').attach('file', Buffer.from('png'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
  });
  it('supports a processed drawing and hides the file from unrelated guests and public media', async () => {
    const event = await setup(); const statement = await question(event);
    const png = await sharp({ create: { width: 100, height: 40, channels: 4, background: '#000000' } }).png().toBuffer();
    const upload = await http().post(`${event.base}/signature-uploads`).attach('file', png, { filename: 'signature.png', contentType: 'image/png' }).expect(201);
    const runner = new PrivateMediaRunner(prisma as unknown as PrismaService, app.get(PrivateStorageService)); await runner.runOne();
    const preview = await http().get(`${event.base}/signature-uploads/${upload.body.id}/file`).expect(200);
    expect((preview.body as Buffer).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(preview.headers['cache-control']).toContain('no-store'); expect(preview.headers['content-type']).toContain('image/png');
    const ack = await http().post(`${event.base}/acknowledgements`).send({ ...typed(statement.statementVersionId, event.guest.id), method: 'DRAWN', assetId: upload.body.id }).expect(201);
    await http().get(`${event.base}/acknowledgements/${ack.body.records[0].id}/file`).expect(200);
    await http().get(`${event.base}/gallery/${upload.body.id}/file`).expect(404);
    await http().delete(`${event.base}/signature-uploads/${upload.body.id}`).expect(409);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
  it('requires every current statement and rolls attendance back when one is missing', async () => {
    const event = await setup(); const first = await question(event); const second = await question(event);
    await http().post(`${event.base}/acknowledgements`).send(typed(first.statementVersionId, event.guest.id)).expect(201);
    await http().post(`${event.base}/rsvp`).send({ status: 'ATTENDING' }).expect(400);
    expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('PENDING');
    await http().post(`${event.base}/acknowledgements`).send(typed(second.statementVersionId, event.guest.id)).expect(201);
    await http().post(`${event.base}/rsvp`).send({ status: 'ATTENDING' }).expect(201);
  });
  it('lets a representative acknowledge a new plus-one atomically with attendance', async () => {
    const event = await setup(); const statement = await question(event);
    const value = typed(statement.statementVersionId, event.guest.id);
    const { subjectGuestIds: _subjects, ...answer } = value;
    const payload = { status: 'ATTENDING', answers: [{ questionId: statement.id, value: answer }],
      party: [{ firstName: 'Companion', answers: [{ questionId: statement.id, value: { ...answer, isRepresentative: true } }] }] };
    await http().post(`${event.base}/rsvp`).send(payload).expect(201);
    const records = await prisma.guestAcknowledgement.findMany({ where: { eventId: event.eventId } });
    expect(records).toHaveLength(2); expect(records.every((record) => record.signerGuestId === event.guest.id)).toBe(true);
    expect(records.filter((record) => record.isRepresentative)).toHaveLength(1);
  });
  it('finishes ticket checkout without signing and gates both ticket and guest admission', async () => {
    const event = await ticketEvent(prisma); const auth = await authenticateAs(app, prisma, { eventId: event.eventId });
    const q = await http().post(`/api/v1/invitations/${event.invitationSlug}/questions`).set('Authorization', auth.authorization)
      .send({ type: 'SIGNATURE', required: true, prompt: { en: 'Admission rules' } }).expect(201);
    const checkout = await http().post(`/api/v1/public/events/${event.slug}/orders`).send({ buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Attendee', email: 'attendee@test.local' }] }).expect(201);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: checkout.body.orderId } });
    const order = await prisma.ticketOrder.findUniqueOrThrow({ where: { id: ticket.orderId } });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: ticket.guestId! } });
    expect(JSON.stringify(checkout.body)).not.toContain(guest.token); expect(await prisma.guestAcknowledgement.count()).toBe(0);
    const route = `/api/v1/events/${event.eventId}`;
    await http().post(`${route}/tickets/${ticket.code}/admit`).set('Authorization', auth.authorization).expect(400);
    await http().post(`${route}/guests/${guest.id}/check-in`).set('Authorization', auth.authorization).expect(400);
    const base = `/api/v1/invitations/${event.invitationSlug}/g/`;
    await http().post(`${base}${order.accessToken}/acknowledgements`).send(typed(String(q.body.statementVersionId), guest.id)).expect(404);
    await http().post(`${base}${guest.token}/acknowledgements`).send(typed(String(q.body.statementVersionId), guest.id)).expect(201);
    await http().post(`${route}/tickets/${ticket.code}/admit`).set('Authorization', auth.authorization).expect(201);
  });

});
