import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * A diaspora family reads the same invitation in three languages. The
 * personal page could not switch language — only an RSVP could change it —
 * and the event's title, the hosts' names and the venue were one string in
 * one language whatever the page was in.
 */
describe('Reading the invitation in another language (e2e)', () => {
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

  const host = async () => {
    const seeded = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: EventRole.OWNER });
    await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { locale: 'hy' } });
    await prisma.designTemplate.update({
      where: { key: 'test-template' },
      data: { supportedBlocks: ['HERO', 'VENUE', 'RSVP'] },
    });
    await http()
      .patch(`/api/v1/invitations/${seeded.slug}/arrangement`)
      .set('Authorization', authorization)
      .send({ blocks: [{ type: 'HERO' }, { type: 'VENUE' }, { type: 'RSVP' }] })
      .expect(200);
    return { ...seeded, authorization };
  };

  const personalPage = async (slug: string, token: string, locale?: string) =>
    (await http().get(`/api/v1/invitations/${slug}/g/${token}`).query(locale ? { locale } : {}).expect(200)).body as {
      locale: string;
      event: { title: string; hosts: string };
      blocks: { type: string; content: unknown; data: { name: string; address: string }[] | null }[];
    };

  it('switches a guest’s personal page to another language the event publishes', async () => {
    const { slug, primaryGuestToken } = await host();

    expect((await personalPage(slug, primaryGuestToken)).locale).toBe('hy');
    const english = await personalPage(slug, primaryGuestToken, 'en');

    expect(english.locale).toBe('en');
    expect(english.blocks.find((b) => b.type === 'HERO')?.content).toEqual({ title: 'Hello' });
  });

  it('stays in the guest’s own language when asked for one the event does not publish', async () => {
    const { slug, primaryGuestToken } = await host();

    expect((await personalPage(slug, primaryGuestToken, 'ru')).locale).toBe('hy');
  });

  it('shows the title and hosts in the page’s language, falling back to the original', async () => {
    const { eventId, slug, primaryGuestToken, authorization } = await host();

    await http()
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', authorization)
      .send({ translations: { en: { title: 'The wedding of Anna and Davit', hostsLabel: 'Anna & Davit' } } })
      .expect(200);

    expect((await personalPage(slug, primaryGuestToken, 'en')).event).toMatchObject({
      title: 'The wedding of Anna and Davit',
      hosts: 'Anna & Davit',
    });
    expect((await personalPage(slug, primaryGuestToken, 'hy')).event).toMatchObject({
      title: 'Fixture Wedding',
      hosts: 'A & B',
    });
  });

  it('shows the venue’s name and address in the page’s language', async () => {
    const { eventId, slug, primaryGuestToken, authorization } = await host();
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId } });

    await http()
      .patch(`/api/v1/events/${eventId}/venues/${venue.id}`)
      .set('Authorization', authorization)
      .send({ translations: { en: { name: 'Garden Hall', address: '12 Garden Lane, Yerevan' } } })
      .expect(200);

    const english = await personalPage(slug, primaryGuestToken, 'en');
    expect(english.blocks.find((b) => b.type === 'VENUE')?.data?.[0]).toMatchObject({
      name: 'Garden Hall',
      address: '12 Garden Lane, Yerevan',
    });
    const armenian = await personalPage(slug, primaryGuestToken, 'hy');
    expect(armenian.blocks.find((b) => b.type === 'VENUE')?.data?.[0]).toMatchObject({ name: 'Fixture Hall' });
  });

  it('edits one language at a time, and removes one sent as null', async () => {
    const { eventId, authorization } = await host();
    const edit = (translations: Record<string, unknown>) =>
      http().patch(`/api/v1/events/${eventId}`).set('Authorization', authorization).send({ translations }).expect(200);

    await edit({ en: { title: 'English title' } });
    await edit({ ru: { title: 'Русское название' } });
    const { body } = await edit({ en: null });

    expect(body.translations).toEqual({ ru: { title: 'Русское название' } });
  });

  it.each([
    [{ English: { title: 'x' } }],
    [{ en: { title: 42 } }],
    [{ en: { motto: 'unknown field' } }],
  ])('refuses translations %j with a 400 naming the field', async (translations) => {
    const { eventId, authorization } = await host();

    const { body } = await http()
      .patch(`/api/v1/events/${eventId}`)
      .set('Authorization', authorization)
      .send({ translations })
      .expect(400);

    expect(body.message).toMatch(/^translations: /);
  });
});
