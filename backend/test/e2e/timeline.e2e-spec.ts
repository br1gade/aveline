import { reviseTemplateFixture } from '../fixtures/template.fixture';
import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient, EventVisibility } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * The running order serves two audiences. Guests see the ceremony, the first
 * dance, the cake; the people running the day also need "caterer arrives
 * 10:00" and "speeches cue" — which, before entries could be marked internal,
 * would have appeared on every guest's invitation.
 */
describe('The running order (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  /** A coordinator, an invitation that shows its running order, and two entries — one internal. */
  const runningOrder = async () => {
    const seeded = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: EventRole.COORDINATOR });
    await reviseTemplateFixture(prisma, {
      where: { key: 'test-template' },
      data: { supportedBlocks: ['HERO', 'TIMELINE', 'RSVP'] },
    });
    await http()
      .patch(`/api/v1/invitations/${seeded.slug}/arrangement`)
      .set('Authorization', authorization)
      .send({ blocks: [{ type: 'HERO' }, { type: 'TIMELINE' }, { type: 'RSVP' }] })
      .expect(200);
    const add = (body: Record<string, unknown>) =>
      http().post(`/api/v1/events/${seeded.eventId}/timeline`).set('Authorization', authorization).send(body).expect(201);
    const ceremony = await add({ label: { en: 'Ceremony' }, occursAt: '2027-06-12T15:00:00Z' });
    const loadIn = await add({ label: { en: 'Caterer arrives' }, occursAt: '2027-06-12T10:00:00Z', isInternal: true });
    return { ...seeded, authorization, ceremonyId: ceremony.body.id as string, loadInId: loadIn.body.id as string };
  };

  const labelsOnGuestPage = async (slug: string) => {
    const { body } = await http().get(`/api/v1/invitations/${slug}`).query({ locale: 'en' }).expect(200);
    const block = (body.blocks as { type: string; data: { label: string }[] }[]).find((b) => b.type === 'TIMELINE');
    return block?.data.map((entry) => entry.label);
  };

  it('keeps internal entries off the guest’s invitation', async () => {
    const { slug } = await runningOrder();

    expect(await labelsOnGuestPage(slug)).toEqual(['Ceremony']);
  });

  it('shows the host every entry, marked', async () => {
    const { eventId, authorization } = await runningOrder();

    const { body } = await http().get(`/api/v1/events/${eventId}/timeline`).set('Authorization', authorization).expect(200);

    expect(body).toEqual([
      expect.objectContaining({ label: { en: 'Caterer arrives' }, isInternal: true }),
      expect.objectContaining({ label: { en: 'Ceremony' }, isInternal: false }),
    ]);
  });

  it('gives a vendor the whole running order, internal entries included', async () => {
    const { eventId } = await runningOrder();
    const vendor = await prisma.vendor.create({ data: { name: 'Caterer', category: 'CATERING' } });
    await prisma.vendorBooking.create({
      data: { eventId, vendorId: vendor.id, briefToken: 'brief-for-the-caterer', briefScopes: ['timeline'] },
    });

    const { body } = await http().get('/api/v1/briefs/brief-for-the-caterer').expect(200);

    expect((body.timeline as { label: string }[]).map((entry) => entry.label)).toEqual([
      'Caterer arrives',
      'Ceremony',
    ]);
  });

  it('moves an entry between audiences with a partial edit, and the page follows', async () => {
    const { eventId, slug, authorization, ceremonyId } = await runningOrder();
    expect(await labelsOnGuestPage(slug)).toEqual(['Ceremony']);

    await http()
      .patch(`/api/v1/events/${eventId}/timeline/${ceremonyId}`)
      .set('Authorization', authorization)
      .send({ isInternal: true })
      .expect(200);

    expect(await labelsOnGuestPage(slug)).toEqual([]);
  });

  it('detaches an entry from its venue when venueId is sent as null', async () => {
    const { eventId, authorization, ceremonyId } = await runningOrder();
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId } });
    const edit = (venueId: string | null) =>
      http()
        .patch(`/api/v1/events/${eventId}/timeline/${ceremonyId}`)
        .set('Authorization', authorization)
        .send({ venueId })
        .expect(200);

    await edit(venue.id);
    const { body } = await edit(null);

    expect(body.venueId).toBeNull();
  });

  describe('edits that keep what they do not mention', () => {
    const patch = (eventId: string, entryId: string, authorization: string, body: Record<string, unknown>) =>
      http().patch(`/api/v1/events/${eventId}/timeline/${entryId}`).set('Authorization', authorization).send(body);

    // B94: occursAt null was stored as 1 January 1970.
    it('refuses a null time rather than storing 1970', async () => {
      const { eventId, ceremonyId, authorization } = await runningOrder();

      const { body } = await patch(eventId, ceremonyId, authorization, { occursAt: null }).expect(400);

      expect(JSON.stringify(body.message)).toContain('occursAt');
    });

    // B92: correcting the English label deleted the Armenian one.
    it('edits one language of a label and keeps the others', async () => {
      const { eventId, ceremonyId, authorization } = await runningOrder();
      await patch(eventId, ceremonyId, authorization, { label: { hy: 'Պսակադրություն' } }).expect(200);

      await patch(eventId, ceremonyId, authorization, { label: { en: 'Wedding ceremony' } }).expect(200);

      const entry = await prisma.timelineEntry.findUniqueOrThrow({ where: { id: ceremonyId } });
      expect(entry.label).toEqual({ en: 'Wedding ceremony', hy: 'Պսակադրություն' });
    });

    // B89: {"hy": ""} counted as a label and rendered a blank row.
    it('refuses a label that is blank in every language', async () => {
      const { eventId, authorization } = await runningOrder();

      await http().post(`/api/v1/events/${eventId}/timeline`).set('Authorization', authorization).send({ label: { hy: '  ' }, occursAt: '2027-06-12T16:00:00Z' }).expect(400);
    });

    // B92: two entries at the same minute appeared in arbitrary order.
    it('orders entries at the same minute as the host arranged them', async () => {
      const { eventId, slug, authorization } = await runningOrder();
      const add = (label: string, sortOrder: number) =>
        http().post(`/api/v1/events/${eventId}/timeline`).set('Authorization', authorization).send({ label: { en: label }, occursAt: '2027-06-12T18:00:00Z', sortOrder }).expect(201);
      await add('Toast', 2);
      await add('First dance', 1);

      const labels = await labelsOnGuestPage(slug);

      expect(labels?.slice(-2)).toEqual(['First dance', 'Toast']);
    });
  });

  // B92 (decided 10 October 2026, D17): guests saw every venue, including
  // where the bride gets ready and places only the crew's entries use.
  it('shows guests only the venues meant for them', async () => {
    const { eventId, slug, authorization } = await runningOrder();
    await reviseTemplateFixture(prisma, { where: { key: 'test-template' }, data: { supportedBlocks: ['HERO', 'VENUE', 'TIMELINE', 'RSVP'] } });
    await http().patch(`/api/v1/invitations/${slug}/arrangement`).set('Authorization', authorization).send({ blocks: [{ type: 'HERO' }, { type: 'VENUE' }, { type: 'TIMELINE' }, { type: 'RSVP' }] }).expect(200);
    const venue = (role: string, name: string) =>
      http().post(`/api/v1/events/${eventId}/venues`).set('Authorization', authorization).send({ role, name, address: 'Yerevan' }).expect(201);
    await venue('PREPARATION', 'The family home');
    const kitchen = await venue('OTHER', 'Service entrance');
    await http().post(`/api/v1/events/${eventId}/timeline`).set('Authorization', authorization).send({ label: { en: 'Load in' }, occursAt: '2027-06-12T09:00:00Z', isInternal: true, venueId: kitchen.body.id }).expect(201);

    const { body } = await http().get(`/api/v1/invitations/${slug}`).query({ locale: 'en' }).expect(200);

    const names = (body.blocks as { type: string; data: { name: string }[] }[]).find((b) => b.type === 'VENUE')?.data.map((v) => v.name);
    expect(names).toEqual(['Fixture Hall']);
  });
});
