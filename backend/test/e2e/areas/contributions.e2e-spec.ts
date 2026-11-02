import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { contributionsApp, contributionsHelpers, ContributionsHttp, drawing, drawn, PNG_SIGNATURE, typed } from '../../fixtures/areas/contributions.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const MEBIBYTE = 1024 * 1024;

describe('Guest acknowledgements and gallery (e2e coverage)', () => {
  let prisma: PrismaClient; let app: INestApplication; let close: () => Promise<void>; let h: ContributionsHttp;
  beforeAll(async () => {
    prisma = testPrisma();
    ({ app, close } = await contributionsApp(prisma));
    h = contributionsHelpers(app, prisma);
  });
  beforeEach(() => resetTestDatabase());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await close(); await disconnectTestDatabase(); });
  const backdate = (id: string, minutesAgo: number) =>
    prisma.guestAcknowledgement.update({ where: { id }, data: { createdAt: new Date(Date.now() - minutesAgo * 60_000) } });
  const recordIds = (body: unknown) => (body as { records: { id: string }[] }).records.map((record) => record.id);

  describe('acknowledgement history', () => {
    /** Guest A's household signs twice for A; a neighbouring household signs its own record. */
    const history = async () => {
      const event = await h.setup(); const statement = await h.question(event);
      const member = await h.member(event); const neighbour = await h.otherHousehold(event);
      const own = await h.http().post(`${event.base}/acknowledgements`).send(typed(statement.statementVersionId, event.guest.id)).expect(201);
      const forA = await h.http().post(`${member.base}/acknowledgements`)
        .send({ ...typed(statement.statementVersionId, event.guest.id), signerName: 'Member', isRepresentative: true }).expect(201);
      const foreign = await h.http().post(`${neighbour.base}/acknowledgements`).send(typed(statement.statementVersionId, neighbour.guest.id)).expect(201);
      const ids = { own: own.body.records[0].id as string, forA: forA.body.records[0].id as string, foreign: foreign.body.records[0].id as string };
      await backdate(ids.own, 10); await backdate(ids.forA, 5);
      return { event, ids };
    };

    it('lists records the household signed for the guest and leaves out other households’ records', async () => {
      const { event, ids } = await history();
      const { body } = await h.http().get(`${event.base}/acknowledgements`).expect(200);
      expect(recordIds(body)).toEqual([ids.forA, ids.own]);
      expect(body.nextCursor).toBeNull();
    });
    it('pages newest first with a cursor until the visible history ends', async () => {
      const { event, ids } = await history();
      const first = await h.http().get(`${event.base}/acknowledgements?limit=1`).expect(200);
      expect(recordIds(first.body)).toEqual([ids.forA]);
      expect(first.body.nextCursor).toBe(ids.forA);
      const second = await h.http().get(`${event.base}/acknowledgements?limit=1&after=${String(first.body.nextCursor)}`).expect(200);
      expect(recordIds(second.body)).toEqual([ids.own]);
      const end = await h.http().get(`${event.base}/acknowledgements?limit=1&after=${String(second.body.nextCursor)}`).expect(200);
      expect(end.body).toMatchObject({ records: [], nextCursor: null });
    });
    it('answers 404 to a cursor naming another household’s record', async () => {
      const { event, ids } = await history();
      await h.http().get(`${event.base}/acknowledgements?after=${ids.foreign}`).expect(404);
    });
    it.each([0, 101, 'many'])('refuses page size %p naming limit', async (limit) => {
      const event = await h.setup();
      const { body } = await h.http().get(`${event.base}/acknowledgements?limit=${limit}`).expect(400);
      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'limit' })]));
    });
    it.each([1, 100])('accepts page size %i', async (limit) => {
      const event = await h.setup();
      await h.http().get(`${event.base}/acknowledgements?limit=${limit}`).expect(200);
    });
  });

  describe('signature upload previews', () => {
    it('serves nothing while the upload is still queued', async () => {
      const event = await h.setup(); const upload = await h.uploadSignature(event.base);
      await h.http().get(`${event.base}/signature-uploads/${upload.id}/file`).expect(404);
    });
    it('serves a processed preview to its owner and to nobody else in the household', async () => {
      const event = await h.setup(); const member = await h.member(event);
      const upload = await h.uploadSignature(event.base); await h.runWorker();
      await h.http().get(`${member.base}/signature-uploads/${upload.id}/file`).expect(404);
      const preview = await h.http().get(`${event.base}/signature-uploads/${upload.id}/file`).expect(200);
      expect((preview.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
    it('serves nothing for an upload the worker rejected', async () => {
      const event = await h.setup();
      const { body } = await h.http().post(`${event.base}/signature-uploads`).attach('file', Buffer.from('not-an-image'), { filename: 's.png', contentType: 'image/png' }).expect(201);
      await h.runWorker();
      expect(await prisma.guestMedia.findUniqueOrThrow({ where: { id: body.id as string } })).toMatchObject({ processingStatus: 'FAILED' });
      await h.http().get(`${event.base}/signature-uploads/${String(body.id)}/file`).expect(404);
    });
  });

  describe('drawn acknowledgement files', () => {
    /** The primary guest draws an acknowledgement on behalf of a household member. */
    const represented = async () => {
      const event = await h.setup(); const statement = await h.question(event);
      const subject = await h.member(event, 'Subject'); const relative = await h.member(event, 'Relative'); const neighbour = await h.otherHousehold(event);
      const upload = await h.uploadSignature(event.base); await h.runWorker();
      const { body } = await h.http().post(`${event.base}/acknowledgements`)
        .send({ ...drawn(statement.statementVersionId, subject.guest.id, upload.id), isRepresentative: true }).expect(201);
      const route = (base: string) => `${base}/acknowledgements/${String(body.records[0].id)}/file`;
      return { event, subject, relative, neighbour, route };
    };

    it('lets the represented subject and their household read the drawing', async () => {
      const { subject, relative, route } = await represented();
      const read = await h.http().get(route(subject.base)).expect(200);
      expect(read.headers['cache-control']).toContain('no-store');
      expect((read.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
      const household = await h.http().get(route(relative.base)).expect(200);
      expect((household.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
    });
    it('hides the drawing from a household that is neither signer nor subject', async () => {
      const { neighbour, route } = await represented();
      await h.http().get(route(neighbour.base)).expect(404);
    });
    it('refuses the read when the reader leaves the subject’s household while the file is fetched', async () => {
      const { relative, neighbour, route } = await represented();
      const storage = app.get(PrivateStorageService); const get = storage.get.bind(storage);
      jest.spyOn(storage, 'get').mockImplementationOnce(async (key) => {
        const data = await get(key);
        await prisma.guest.update({ where: { id: relative.guest.id }, data: { householdId: neighbour.guest.householdId } });
        return data;
      });
      await h.http().get(route(relative.base)).expect(404);
    });
  });

  describe('removing a signature upload', () => {
    it('removes an unclaimed upload so it can no longer be listed or signed with', async () => {
      const event = await h.setup(); const statement = await h.question(event);
      const upload = await h.uploadSignature(event.base); await h.runWorker();
      expect((await h.http().delete(`${event.base}/signature-uploads/${upload.id}`).expect(200)).body).toEqual({ removed: upload.id });
      const { body } = await h.http().get(`${event.base}/acknowledgements`).expect(200);
      expect(body.signatureUploads).toEqual([]);
      const refused = await h.http().post(`${event.base}/acknowledgements`).send(drawn(statement.statementVersionId, event.guest.id, upload.id)).expect(400);
      expect(refused.body.message).toMatch(/^assetId: /);
    });
    it('answers 404 to removing the same upload twice', async () => {
      const event = await h.setup(); const upload = await h.uploadSignature(event.base);
      await h.http().delete(`${event.base}/signature-uploads/${upload.id}`).expect(200);
      await h.http().delete(`${event.base}/signature-uploads/${upload.id}`).expect(404);
    });
  });

  describe('signature answers inside an RSVP', () => {
    it('refuses a statement belonging to another question and writes nothing', async () => {
      const event = await h.setup();
      const first = await h.question(event, false, 'First'); const second = await h.question(event, false, 'Second');
      const { subjectGuestIds: _subjects, ...answer } = typed(second.statementVersionId, event.guest.id);
      const { body } = await h.http().post(`${event.base}/rsvp`).send({ status: 'ATTENDING', answers: [{ questionId: first.id, value: answer }] }).expect(400);
      expect(body.message).toBe('answers: the statement belongs to another question');
      expect(await prisma.guestAcknowledgement.count()).toBe(0);
      expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('PENDING');
    });
    it('refuses a signature answer recorded by the host, who is not the signer', async () => {
      const event = await h.setup(); const statement = await h.question(event, false);
      const { subjectGuestIds: _subjects, ...answer } = typed(statement.statementVersionId, event.guest.id);
      const { body } = await h.http().patch(`/api/v1/events/${event.eventId}/guests/${event.guest.id}/rsvp`).set('Authorization', event.authorization)
        .send({ status: 'ATTENDING', answers: [{ questionId: statement.id, value: answer }] }).expect(400);
      expect(body.message).toMatch(/^answers: acknowledgements require the actual signer/);
      expect(await prisma.guestAcknowledgement.count()).toBe(0);
      expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('PENDING');
    });
  });

  describe('who the acknowledgement gate applies to', () => {
    it('lets a guest decline without acknowledging a required statement', async () => {
      const event = await h.setup(); await h.question(event);
      await h.http().post(`${event.base}/rsvp`).send({ status: 'DECLINED' }).expect(201);
      expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('DECLINED');
      expect(await prisma.guestAcknowledgement.count()).toBe(0);
    });
    it('still gates the same guest when they change their answer to attending', async () => {
      const event = await h.setup(); await h.question(event);
      await h.http().post(`${event.base}/rsvp`).send({ status: 'DECLINED' }).expect(201);
      const { body } = await h.http().post(`${event.base}/rsvp`).send({ status: 'ATTENDING' }).expect(400);
      expect(body.message).toMatch(/^acknowledgements: /);
      expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: event.guest.id } })).status).toBe('DECLINED');
    });
  });

  it.each(['acknowledgements', 'gallery'])('keeps %s readable after the host closes the invitation', async (path) => {
    const event = await h.setup();
    await h.http().post(`/api/v1/invitations/${event.slug}/close`).set('Authorization', event.authorization).expect(201);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } })).status).toBe('CLOSED');
    await h.http().get(`${event.base}/${path}`).expect(200);
  });

  describe('upload size', () => {
    it.each([
      ['gallery', 10 * MEBIBYTE + 1],
      ['signature-uploads', MEBIBYTE + 1],
    ])('answers 413 to a %s file one byte over its limit', async (path, bytes) => {
      const event = await h.setup();
      await h.http().post(`${event.base}/${path}`).attach('file', Buffer.alloc(bytes, 1), { filename: 'big.png', contentType: 'image/png' }).expect(413);
      expect(await prisma.guestMedia.count()).toBe(0);
    });
    it.each([
      ['gallery', 10 * MEBIBYTE],
      ['signature-uploads', MEBIBYTE],
    ])('accepts a %s file of exactly its limit', async (path, bytes) => {
      const event = await h.setup();
      await h.http().post(`${event.base}/${path}`).attach('file', Buffer.alloc(bytes, 1), { filename: 'big.png', contentType: 'image/png' }).expect(201);
      expect(await prisma.guestMedia.count()).toBe(1);
    });
    it.each(['gallery', 'signature-uploads'])('refuses an empty %s file', async (path) => {
      const event = await h.setup();
      const { body } = await h.http().post(`${event.base}/${path}`).attach('file', Buffer.alloc(0), { filename: 'empty.png', contentType: 'image/png' }).expect(413);
      expect(body.message).toMatch(/^file: use a nonempty image/);
      expect(await prisma.guestMedia.count()).toBe(0);
    });
  });

  it('answers 503 when private storage is down and leaves the staged upload REMOVED', async () => {
    const event = await h.setup();
    jest.spyOn(app.get(PrivateStorageService), 'put').mockRejectedValueOnce(new Error('down'));
    await h.http().post(`${event.base}/gallery`).attach('file', await drawing(), { filename: 'photo.png', contentType: 'image/png' }).expect(503);
    expect(await prisma.guestMedia.findMany({ select: { processingStatus: true } })).toEqual([{ processingStatus: 'REMOVED' }]);
  });

  describe('gallery list items', () => {
    const approvedPhoto = async () => {
      const event = await h.setup(); const neighbour = await h.otherHousehold(event);
      await prisma.guest.update({ where: { id: event.guest.id }, data: { email: 'uploader@test.local', phone: '+37491000000' } });
      const photo = await h.uploadPhoto(event.base, 'Dance floor'); await h.runWorker();
      await h.http().patch(`/api/v1/events/${event.eventId}/gallery/${photo.id}`).set('Authorization', event.authorization).send({ moderationStatus: 'APPROVED' }).expect(200);
      return { event, neighbour, photo };
    };
    const LEAKS = /uploaderGuestId|sourceKey|displayKey|thumbnailKey|email|phone|uploader@test\.local|\+37491000000/;

    it('marks the uploader’s own photo and another guest’s view of it', async () => {
      const { event, neighbour, photo } = await approvedPhoto();
      const own = await h.http().get(`${event.base}/gallery`).expect(200);
      const other = await h.http().get(`${neighbour.base}/gallery`).expect(200);
      expect(own.body.items).toEqual([expect.objectContaining({ id: photo.id, isOwn: true, caption: 'Dance floor' })]);
      expect(other.body.items).toEqual([expect.objectContaining({ id: photo.id, isOwn: false })]);
    });
    it('leaves storage keys, uploader IDs and contacts out of guest and host lists', async () => {
      const { event, neighbour } = await approvedPhoto();
      const own = await h.http().get(`${event.base}/gallery`).expect(200);
      const other = await h.http().get(`${neighbour.base}/gallery`).expect(200);
      const host = await h.http().get(`/api/v1/events/${event.eventId}/gallery`).set('Authorization', event.authorization).expect(200);
      for (const body of [own.body, other.body, host.body]) expect(JSON.stringify(body)).not.toMatch(LEAKS);
      expect(JSON.stringify(other.body)).not.toContain(event.guest.id);
      expect(JSON.stringify(host.body)).not.toContain(event.guest.id);
    });
  });
});
