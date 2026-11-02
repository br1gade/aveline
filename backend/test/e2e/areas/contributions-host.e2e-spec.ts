import { INestApplication } from '@nestjs/common';
import { EventRole, PlatformRole, PrismaClient } from '@prisma/client';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { contributionsApp, contributionsHelpers, ContributionsHttp, drawing, drawn, PNG_SIGNATURE, typed } from '../../fixtures/areas/contributions.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

describe('Host acknowledgements, gallery moderation and privacy files (e2e coverage)', () => {
  let prisma: PrismaClient; let app: INestApplication; let close: () => Promise<void>; let h: ContributionsHttp;
  beforeAll(async () => {
    prisma = testPrisma();
    ({ app, close } = await contributionsApp(prisma));
    h = contributionsHelpers(app, prisma);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => { await close(); await disconnectTestDatabase(); });

  /** A processed gallery photo and a representative drawn acknowledgement, both on one event. */
  const contributions = async () => {
    const event = await h.setup(); const statement = await h.question(event); const subject = await h.member(event, 'Subject');
    const photo = await h.uploadPhoto(event.base, 'First dance');
    const signature = await h.uploadSignature(event.base);
    while (await h.runWorker()) { /* drain the private media queue */ }
    const signed = await h.http().post(`${event.base}/acknowledgements`)
      .send({ ...drawn(statement.statementVersionId, subject.guest.id, signature.id), isRepresentative: true }).expect(201);
    return { event, statement, subject, photo, signature, acknowledgementId: signed.body.records[0].id as string };
  };
  const host = (eventId: string) => `/api/v1/events/${eventId}`;
  const moderate = (eventId: string, mediaId: string, authorization: string, moderationStatus: string) =>
    h.http().patch(`${host(eventId)}/gallery/${mediaId}`).set('Authorization', authorization).send({ moderationStatus });

  describe('acknowledgement history for hosts', () => {
    it('lists the actual signer and the represented subject of each record', async () => {
      const { event, subject, acknowledgementId } = await contributions();
      const { body } = await h.http().get(`${host(event.eventId)}/acknowledgements`).set('Authorization', event.authorization).expect(200);
      expect(body).toEqual({ items: [expect.objectContaining({ id: acknowledgementId, signerGuestId: event.guest.id, subjectGuestId: subject.guest.id,
        isRepresentative: true, method: 'DRAWN' })], nextCursor: null });
    });
    it('pages host history newest first with a cursor until it ends', async () => {
      const { event, statement, acknowledgementId } = await contributions();
      const newer = await h.http().post(`${event.base}/acknowledgements`).send(typed(statement.statementVersionId, event.guest.id)).expect(201);
      await prisma.guestAcknowledgement.update({ where: { id: acknowledgementId }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
      const page = (after = '') => h.http().get(`${host(event.eventId)}/acknowledgements?limit=1${after && `&after=${after}`}`).set('Authorization', event.authorization).expect(200);
      const first = await page();
      expect(first.body).toEqual({ items: [expect.objectContaining({ id: newer.body.records[0].id as string })], nextCursor: newer.body.records[0].id as string });
      const second = await page(String(first.body.nextCursor));
      expect(second.body.items).toEqual([expect.objectContaining({ id: acknowledgementId })]);
      expect((await page(String(second.body.nextCursor))).body).toEqual({ items: [], nextCursor: null });
    });
    it('serves the drawn acknowledgement as an uncached PNG', async () => {
      const { event, acknowledgementId } = await contributions();
      const file = await h.http().get(`${host(event.eventId)}/acknowledgements/${acknowledgementId}/file`).set('Authorization', event.authorization).expect(200);
      expect((file.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
      expect(file.headers['content-type']).toContain('image/png');
      expect(file.headers['cache-control']).toContain('no-store');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
    });
    it('answers 404 for the file of a typed acknowledgement', async () => {
      const event = await h.setup(); const statement = await h.question(event);
      const { body } = await h.http().post(`${event.base}/acknowledgements`).send(typed(statement.statementVersionId, event.guest.id)).expect(201);
      await h.http().get(`${host(event.eventId)}/acknowledgements/${String(body.records[0].id)}/file`).set('Authorization', event.authorization).expect(404);
    });
  });

  describe('moderation', () => {
    it('refuses to moderate a photo still being processed with 409', async () => {
      const event = await h.setup(); const photo = await h.uploadPhoto(event.base);
      await moderate(event.eventId, photo.id, event.authorization, 'APPROVED').expect(409);
      expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: photo.id } })).toMatchObject({ moderationStatus: 'PENDING' });
    });
    it('rejects a processed photo and records who moderated it', async () => {
      const { event, photo } = await contributions();
      const { body } = await moderate(event.eventId, photo.id, event.authorization, 'REJECTED').expect(200);
      expect(body).toMatchObject({ id: photo.id, moderationStatus: 'REJECTED' });
      expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: photo.id } })).toMatchObject({ moderatedBy: event.userId });
    });
    it('refuses to moderate a photo its owner removed with 409', async () => {
      const { event, photo } = await contributions();
      await h.http().delete(`${event.base}/gallery/${photo.id}`).expect(200);
      await moderate(event.eventId, photo.id, event.authorization, 'APPROVED').expect(409);
    });
    it.each(['PENDING', 'MAYBE'])('refuses moderation status %s naming the field', async (status) => {
      const { event, photo } = await contributions();
      const { body } = await moderate(event.eventId, photo.id, event.authorization, status).expect(400);
      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'moderationStatus' })]));
    });
  });

  describe('host removal of a photo', () => {
    it('removes any guest’s photo, clears its caption and queues cleanup', async () => {
      const { event, photo } = await contributions();
      expect((await h.http().delete(`${host(event.eventId)}/gallery/${photo.id}`).set('Authorization', event.authorization).expect(200)).body).toEqual({ removed: photo.id });
      expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: photo.id } }))
        .toMatchObject({ processingStatus: 'REMOVED', caption: null, removedAt: expect.any(Date) as Date, cleanupAfter: expect.any(Date) as Date });
    });
    it('drops a removed photo from both the guest and host lists', async () => {
      const { event, photo } = await contributions();
      await h.http().delete(`${host(event.eventId)}/gallery/${photo.id}`).set('Authorization', event.authorization).expect(200);
      expect((await h.http().get(`${event.base}/gallery`).expect(200)).body.items).toEqual([]);
      expect((await h.http().get(`${host(event.eventId)}/gallery`).set('Authorization', event.authorization).expect(200)).body.items).toEqual([]);
    });
    it('answers 404 to removing a photo twice or one that never existed', async () => {
      const { event, photo } = await contributions();
      await h.http().delete(`${host(event.eventId)}/gallery/${photo.id}`).set('Authorization', event.authorization).expect(200);
      await h.http().delete(`${host(event.eventId)}/gallery/${photo.id}`).set('Authorization', event.authorization).expect(404);
      await h.http().delete(`${host(event.eventId)}/gallery/no-such-photo`).set('Authorization', event.authorization).expect(404);
    });
    it('cannot remove a signature drawing through the gallery route', async () => {
      const { event, signature } = await contributions();
      await h.http().delete(`${host(event.eventId)}/gallery/${signature.id}`).set('Authorization', event.authorization).expect(404);
      expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: signature.id } })).toMatchObject({ processingStatus: 'READY' });
    });
  });

  describe.each([EventRole.DESIGNER, EventRole.VIEWER])('a %s without guest:contact:read or guest:write', (role) => {
    const asRole = async () => {
      const seeded = await contributions();
      const actor = await authenticateAs(app, prisma, { eventId: seeded.event.eventId, role });
      return { ...seeded, authorization: actor.authorization, route: host(seeded.event.eventId) };
    };
    it('is refused every host acknowledgement and gallery read', async () => {
      const { route, authorization, acknowledgementId, photo } = await asRole();
      for (const path of ['acknowledgements', `acknowledgements/${acknowledgementId}/file`, 'gallery', `gallery/${photo.id}/file`]) {
        expect([path, (await h.http().get(`${route}/${path}`).set('Authorization', authorization)).status]).toEqual([path, 403]);
      }
    });
    it('is refused moderation and removal, leaving the photo untouched', async () => {
      const { route, authorization, event, photo } = await asRole();
      await moderate(event.eventId, photo.id, authorization, 'APPROVED').expect(403);
      await h.http().delete(`${route}/gallery/${photo.id}`).set('Authorization', authorization).expect(403);
      expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: photo.id } })).toMatchObject({ processingStatus: 'READY', moderationStatus: 'PENDING' });
    });
  });

  describe('another event’s host', () => {
    const twoEvents = async () => {
      const victim = await contributions(); const intruder = await h.setup();
      return { victim, intruder, route: host(intruder.eventId), authorization: intruder.authorization };
    };
    it('cannot list the other event’s acknowledgements or gallery', async () => {
      const { victim, authorization } = await twoEvents();
      await h.http().get(`${host(victim.event.eventId)}/acknowledgements`).set('Authorization', authorization).expect(403);
      await h.http().get(`${host(victim.event.eventId)}/gallery`).set('Authorization', authorization).expect(403);
    });
    it('cannot read the other event’s files through its own event', async () => {
      const { victim, route, authorization } = await twoEvents();
      const own = host(victim.event.eventId);
      await h.http().get(`${own}/acknowledgements/${victim.acknowledgementId}/file`).set('Authorization', victim.event.authorization).expect(200);
      await h.http().get(`${own}/gallery/${victim.photo.id}/file`).set('Authorization', victim.event.authorization).expect(200);
      await h.http().get(`${route}/acknowledgements/${victim.acknowledgementId}/file`).set('Authorization', authorization).expect(404);
      await h.http().get(`${route}/gallery/${victim.photo.id}/file`).set('Authorization', authorization).expect(404);
    });
    it('cannot moderate or remove the other event’s photo through its own event', async () => {
      const { victim, route, authorization, intruder } = await twoEvents();
      const foreign = await moderate(intruder.eventId, victim.photo.id, authorization, 'APPROVED');
      const unknown = await moderate(intruder.eventId, 'no-such-photo', authorization, 'APPROVED');
      expect([foreign.status, unknown.status]).toEqual([409, 409]);
      await h.http().delete(`${route}/gallery/${victim.photo.id}`).set('Authorization', authorization).expect(404);
      expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: victim.photo.id } }))
        .toMatchObject({ processingStatus: 'READY', moderationStatus: 'PENDING', caption: 'First dance' });
    });
  });

  describe('privacy export of original files', () => {
    const officer = async () => {
      const { authorization, userId } = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.ADMIN } });
      return authorization;
    };
    const exportRequest = (subjectEmail: string, status: 'VERIFYING' | 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS') =>
      prisma.dataSubjectRequest.create({ data: { kind: 'EXPORT', subjectEmail, status, dueAt: new Date(Date.now() + 86_400_000) } });
    const subjectFiles = async () => {
      const seeded = await contributions();
      await prisma.guest.update({ where: { id: seeded.event.guest.id }, data: { email: 'person@test.local' } });
      await prisma.guest.update({ where: { id: seeded.subject.guest.id }, data: { email: 'member@test.local' } });
      return { ...seeded, authorization: await officer() };
    };
    const file = (requestId: string, mediaId: string) => `/api/v1/privacy/requests/${requestId}/guest-media/${mediaId}/file`;

    it('downloads the uploader’s original as an untrusted attachment', async () => {
      const { photo, authorization } = await subjectFiles(); const request = await exportRequest('person@test.local');
      const response = await h.http().get(file(request.id, photo.id)).set('Authorization', authorization).buffer(true).expect(200);
      expect(response.headers['content-type']).toContain('application/octet-stream');
      expect(response.headers['content-disposition']).toMatch(/^attachment/);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.body).toEqual(await drawing());
    });
    it('refuses an event owner, who does not hold privacy:manage', async () => {
      const { event, photo } = await subjectFiles(); const request = await exportRequest('person@test.local');
      await h.http().get(file(request.id, photo.id)).set('Authorization', event.authorization).expect(403);
    });
    it('refuses a request whose identity is not yet verified', async () => {
      const { photo, authorization } = await subjectFiles(); const request = await exportRequest('person@test.local', 'VERIFYING');
      const { body } = await h.http().get(file(request.id, photo.id)).set('Authorization', authorization).expect(400);
      expect(body.message).toBe('Verify and start an export request before downloading subject files');
    });
    it('keeps the download available after the export is fulfilled, at the path the export lists', async () => {
      const { photo, authorization } = await subjectFiles(); const request = await exportRequest('person@test.local');
      const fulfilled = await h.http().post(`/api/v1/privacy/requests/${request.id}/fulfil`).set('Authorization', authorization).expect(201);
      expect(JSON.stringify(fulfilled.body)).toContain(file(request.id, photo.id));
      expect(JSON.stringify(fulfilled.body)).not.toMatch(/sourceKey|displayKey|thumbnailKey/);
      expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('COMPLETED');
      await h.http().get(file(request.id, photo.id)).set('Authorization', authorization).expect(200);
    });
    it('lets the represented subject download the drawing signed for them but not the signer’s photo', async () => {
      const { photo, signature, authorization } = await subjectFiles(); const request = await exportRequest('member@test.local');
      await h.http().get(file(request.id, signature.id)).set('Authorization', authorization).expect(200);
      await h.http().get(file(request.id, photo.id)).set('Authorization', authorization).expect(404);
    });
  });
});
