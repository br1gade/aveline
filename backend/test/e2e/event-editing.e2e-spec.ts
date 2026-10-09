import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, MessageChannel, OrganizationRole, PrismaClient, EventVisibility } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Correcting an event after it exists. Its title, date and languages used to
 * be fixed at creation, so a typo in the date was permanent. Walked over HTTP
 * the way a host does it: edit, see the guest page change, and — when guests
 * already hold the invitation — choose whether to tell them.
 */
describe('Editing an event (e2e)', () => {
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

  const host = async (role: EventRole = EventRole.OWNER) => {
    const seeded = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    // A real deployment seeds these as Aveline defaults; the test database starts empty.
    const copy = {
      'invitation.send': '{{guestName}} {{link}}',
      'event.details-changed': '{{guestName}} {{note}} {{link}}',
    };
    for (const [key, body] of Object.entries(copy)) {
      await prisma.messageTemplate.create({
        data: {
          organizationId: event.organizationId,
          key,
          channel: MessageChannel.EMAIL,
          subject: { hy: '{{eventTitle}}' },
          body: { hy: body },
        },
      });
    }
    await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { email: 'armen@test.local' } });
    return { ...seeded, authorization };
  };

  const edit = (eventId: string, authorization: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/events/${eventId}`).set('Authorization', authorization).send(body);

  const guestPage = async (slug: string) =>
    (await http().get(`/api/v1/invitations/${slug}`).expect(200)).body as {
      event: Record<string, unknown>;
      availableLocales: string[];
      blocks: unknown[];
    };

  const sendInvitations = async (slug: string, authorization: string) => {
    const response = await http().post(`/api/v1/invitations/${slug}/send`).set('Authorization', authorization).send({});
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  };

  it('corrects the details, and guests see them at once', async () => {
    const { eventId, slug, authorization } = await host();
    // Read first, so the page is cached and the edit has to drop it.
    expect((await guestPage(slug)).event.title).toBe('Fixture Wedding');

    const { body } = await edit(eventId, authorization, {
      title: 'Anna & Davit',
      hostsLabel: 'Anna & Davit',
      startsAt: '2027-06-12T15:00:00.000Z',
      locales: ['hy', 'en', 'ru'],
    }).expect(200);

    expect(body).toMatchObject({ title: 'Anna & Davit', locales: ['hy', 'en', 'ru'], defaultLocale: 'hy' });
    const page = await guestPage(slug);
    expect(page.event).toMatchObject({ title: 'Anna & Davit', startsAt: '2027-06-12T15:00:00.000Z' });
    expect(page.availableLocales).toEqual(['hy', 'en', 'ru']);
  });

  it('leaves omitted fields alone, and clears an end time sent as null', async () => {
    const { eventId, authorization } = await host();
    await edit(eventId, authorization, { endsAt: '2099-01-01T00:00:00.000Z' }).expect(200);

    const { body } = await edit(eventId, authorization, { endsAt: null }).expect(200);

    expect(body).toMatchObject({ title: 'Fixture Wedding', endsAt: null, timezone: 'Asia/Yerevan' });
  });

  it.each([
    ['a default language the event does not publish', { defaultLocale: 'ru' }, /^defaultLocale: /],
    ['a time zone that does not exist', { timezone: 'Armenia/Yerevan' }, /^timezone: /],
    ['an end before the start', { startsAt: '2027-06-12T15:00:00Z', endsAt: '2027-06-12T10:00:00Z' }, /^endsAt: /],
    ['the same language twice', { locales: ['hy', 'hy'] }, /^locales: /],
    ['a title cleared with null', { title: null }, /^title: /],
  ])('refuses %s with a 400 naming the field, and changes nothing', async (_label, payload, message) => {
    const { eventId, authorization } = await host();

    const { body } = await edit(eventId, authorization, payload).expect(400);

    expect(JSON.stringify(body.message)).toMatch(message.source.replace('^', ''));
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(event).toMatchObject({ title: 'Fixture Wedding', defaultLocale: 'hy', timezone: 'Asia/Yerevan' });
  });

  // A designer shapes the invitation; the event itself is not theirs to change.
  it('refuses a designer', async () => {
    const { eventId, authorization } = await host(EventRole.DESIGNER);

    await edit(eventId, authorization, { title: 'Something else' }).expect(403);
  });

  it('refuses to create an event whose default language it does not publish', async () => {
    const { userId, authorization } = await authenticateAs(app, prisma);
    const organization = await prisma.organization.create({ data: { name: 'Hosts', kind: 'HOST' } });
    await prisma.organizationMembership.create({
      data: { userId, organizationId: organization.id, role: OrganizationRole.OWNER },
    });

    const { body } = await http()
      .post('/api/v1/events')
      .set('Authorization', authorization)
      .send({ type: 'WEDDING', title: 'A & B', startsAt: '2027-06-12T15:00:00Z', locales: ['hy'], defaultLocale: 'en' })
      .expect(400);

    expect(body.message).toMatch(/^defaultLocale: /);
    expect(await prisma.event.count({ where: { organizationId: organization.id } })).toBe(0);
  });

  describe('telling guests who already hold the invitation (decided 8 October 2026: offered, not automatic)', () => {
    it('offers nothing while nobody has been invited', async () => {
      const { eventId, authorization } = await host();

      const { body } = await edit(eventId, authorization, { startsAt: '2027-07-01T15:00:00.000Z' }).expect(200);

      expect(body.notice).toEqual({ isSuggested: false, changed: ['startsAt'], householdsInvited: 0 });
    });

    it('offers to tell them when the date moves, and not when only the wording does', async () => {
      const { eventId, slug, authorization } = await host();
      await sendInvitations(slug, authorization);

      const retitled = await edit(eventId, authorization, { title: 'Anna & Davit' }).expect(200);
      const moved = await edit(eventId, authorization, { startsAt: '2027-07-01T15:00:00.000Z' }).expect(200);

      expect(retitled.body.notice).toMatchObject({ isSuggested: false, changed: [] });
      expect(moved.body.notice).toEqual({ isSuggested: true, changed: ['startsAt'], householdsInvited: 1 });
    });

    it('offers it after a venue changes too, and the guest page shows the new address at once', async () => {
      const { eventId, slug, authorization } = await host();
      // Put the venue on the page: the fixture's template renders only HERO and RSVP.
      await prisma.designTemplate.update({
        where: { key: 'test-template' },
        data: { supportedBlocks: ['HERO', 'VENUE', 'RSVP'] },
      });
      await http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'HERO' }, { type: 'VENUE' }, { type: 'RSVP' }] })
        .expect(200);
      await sendInvitations(slug, authorization);
      const venue = await prisma.venue.findFirstOrThrow({ where: { eventId } });
      const addressOnPage = async () => {
        const page = await guestPage(slug);
        const block = (page.blocks as { type: string; data: { address: string }[] }[]).find((b) => b.type === 'VENUE');
        return block?.data[0]?.address;
      };
      // Read first, so the page is cached and the edit has to drop it.
      expect(await addressOnPage()).toBe('1 Test St');

      const { body } = await http()
        .patch(`/api/v1/events/${eventId}/venues/${venue.id}`)
        .set('Authorization', authorization)
        .send({ address: '12 Garden Lane' })
        .expect(200);

      expect(body).toMatchObject({ name: 'Fixture Hall', address: '12 Garden Lane' });
      expect(body.notice).toEqual({ isSuggested: true, changed: ['venues'], householdsInvited: 1 });
      expect(await addressOnPage()).toBe('12 Garden Lane');
    });

    it('tells every invited household when the host chooses to, with their note, once per press', async () => {
      const { slug, authorization } = await host();
      await sendInvitations(slug, authorization);
      const notify = () =>
        http()
          .post(`/api/v1/invitations/${slug}/notify-changes`)
          .set('Authorization', authorization)
          .send({ note: 'We have moved to the garden.' })
          .expect(201);

      const first = await notify();
      const second = await notify();

      expect(first.body).toMatchObject({ queued: 1, alreadyNotified: 0 });
      expect(second.body).toMatchObject({ queued: 0, alreadyNotified: 1 });
      const message = await prisma.message.findFirstOrThrow({ where: { templateKey: 'event.details-changed' } });
      expect(message.body).toContain('We have moved to the garden.');
      expect(message.toAddress).toBe('armen@test.local');
    });

    it('sends nothing to a household the invitation never reached', async () => {
      const { slug, authorization } = await host();

      const { body } = await http()
        .post(`/api/v1/invitations/${slug}/notify-changes`)
        .set('Authorization', authorization)
        .send({})
        .expect(201);

      expect(body.queued).toBe(0);
    });

    it('refuses a designer', async () => {
      const { slug, authorization } = await host(EventRole.DESIGNER);

      await http()
        .post(`/api/v1/invitations/${slug}/notify-changes`)
        .set('Authorization', authorization)
        .send({})
        .expect(403);
    });
  });
});
