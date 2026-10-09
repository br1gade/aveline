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
 * An event's uploads. A host could upload and attach, and then never see
 * what they had uploaded, remove a photo they regretted, or describe one for
 * a guest who cannot see it.
 */
describe('An event’s uploads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

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

  const designer = async (role: EventRole = EventRole.DESIGNER) => {
    const seeded = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    return { ...seeded, authorization };
  };

  const upload = async (eventId: string, authorization: string) => {
    const { body } = await http()
      .post(`/api/v1/events/${eventId}/media`)
      .set('Authorization', authorization)
      .attach('file', pixel, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    return body as { id: string; url: string };
  };

  const library = async (eventId: string, authorization: string) =>
    (await http().get(`/api/v1/events/${eventId}/media`).set('Authorization', authorization).expect(200)).body as {
      id: string;
      usedBy: string[];
      altText: Record<string, string>;
    }[];

  it('lists every upload, and says which blocks show it', async () => {
    const { eventId, slug, authorization } = await designer();
    const hero = await upload(eventId, authorization);
    const spare = await upload(eventId, authorization);
    await http()
      .patch(`/api/v1/invitations/${slug}/blocks/HERO`)
      .set('Authorization', authorization)
      .send({ assetIds: [hero.id] })
      .expect(200);

    const media = await library(eventId, authorization);

    expect(media.find((m) => m.id === hero.id)).toMatchObject({ kind: 'PHOTO', usedBy: ['HERO'] });
    expect(media.find((m) => m.id === spare.id)).toMatchObject({ usedBy: [] });
  });

  it('describes a photo one language at a time, and guests read it', async () => {
    const { eventId, slug, authorization } = await designer();
    const photo = await upload(eventId, authorization);
    await http()
      .patch(`/api/v1/invitations/${slug}/blocks/HERO`)
      .set('Authorization', authorization)
      .send({ assetIds: [photo.id] })
      .expect(200);
    const describe = (altText: Record<string, unknown>) =>
      http()
        .patch(`/api/v1/events/${eventId}/media/${photo.id}`)
        .set('Authorization', authorization)
        .send({ altText })
        .expect(200);

    await describe({ hy: 'Աննան և Դավիթը' });
    const { body } = await describe({ en: 'Anna and Davit' });

    expect(body.altText).toEqual({ hy: 'Աննան և Դավիթը', en: 'Anna and Davit' });
    const page = await http().get(`/api/v1/invitations/${slug}`).query({ locale: 'en' }).expect(200);
    const heroBlock = (page.body.blocks as { type: string; media: { altText: string }[] }[]).find((b) => b.type === 'HERO');
    expect(heroBlock?.media[0].altText).toBe('Anna and Davit');
    expect((await describe({ en: null })).body.altText).toEqual({ hy: 'Աննան և Դավիթը' });
  });

  it.each([[{ en: 42 }], [{ en: 'x'.repeat(301) }]])('refuses alt text %j, naming the field', async (altText) => {
    const { eventId, authorization } = await designer();
    const photo = await upload(eventId, authorization);

    const { body } = await http()
      .patch(`/api/v1/events/${eventId}/media/${photo.id}`)
      .set('Authorization', authorization)
      .send({ altText })
      .expect(400);

    expect(body.message).toMatch(/^altText: /);
  });

  it('removes a photo nothing shows, file and all', async () => {
    const { eventId, authorization } = await designer();
    const photo = await upload(eventId, authorization);

    await http().delete(`/api/v1/events/${eventId}/media/${photo.id}`).set('Authorization', authorization).expect(200);

    expect(await library(eventId, authorization)).toEqual([]);
    expect((await fetch(photo.url)).status).toBe(404);
  });

  // Deleting it would leave a broken image on the page guests already have.
  it('refuses to remove a photo a block still shows, saying which', async () => {
    const { eventId, slug, authorization } = await designer();
    const photo = await upload(eventId, authorization);
    await http()
      .patch(`/api/v1/invitations/${slug}/blocks/HERO`)
      .set('Authorization', authorization)
      .send({ assetIds: [photo.id] })
      .expect(200);

    const { body } = await http()
      .delete(`/api/v1/events/${eventId}/media/${photo.id}`)
      .set('Authorization', authorization)
      .expect(409);

    expect(body.message).toContain('HERO');
    expect(await library(eventId, authorization)).toHaveLength(1);
  });

  it('404s an upload from another event', async () => {
    const { eventId, authorization } = await designer();
    const other = await designer();
    const theirs = await upload(other.eventId, other.authorization);

    await http().delete(`/api/v1/events/${eventId}/media/${theirs.id}`).set('Authorization', authorization).expect(404);
  });

  it('lets a viewer look but not remove', async () => {
    const { eventId, authorization } = await designer(EventRole.VIEWER);
    const photo = await prisma.mediaAsset.create({ data: { eventId, kind: 'PHOTO', url: 'https://x/y.png' } });

    await library(eventId, authorization);
    await http().delete(`/api/v1/events/${eventId}/media/${photo.id}`).set('Authorization', authorization).expect(403);
  });
});
