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
    await prisma.designTemplate.update({
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
});
