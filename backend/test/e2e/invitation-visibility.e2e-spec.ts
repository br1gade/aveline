import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, EventVisibility, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Who may read an invitation without a personal link. Decided 9 October 2026
 * (D6), as the spec's §13.1 says: a PRIVATE event is reachable by capability
 * link only. Its generic URL used to show the whole page — venue, times — to
 * anyone it was forwarded to.
 */
describe('Reading an invitation without a personal link (e2e)', () => {
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

  const eventWith = async (visibility: EventVisibility) => {
    const seeded = await seedEvent(prisma);
    await prisma.event.update({ where: { id: seeded.eventId }, data: { visibility } });
    return seeded;
  };

  it('does not show a PRIVATE invitation on its generic link', async () => {
    const { slug } = await eventWith(EventVisibility.PRIVATE);

    await http().get(`/api/v1/invitations/${slug}`).expect(404);
  });

  it('shows a PRIVATE invitation on a guest\'s own link', async () => {
    const { slug, primaryGuestToken } = await eventWith(EventVisibility.PRIVATE);

    await http().get(`/api/v1/invitations/${slug}/g/${primaryGuestToken}`).expect(200);
  });

  // The personal path must be a personal link: a token that is no guest's is
  // the generic URL with extra steps.
  it('does not show a PRIVATE invitation for a token that is no guest\'s', async () => {
    const { slug } = await eventWith(EventVisibility.PRIVATE);

    await http().get(`/api/v1/invitations/${slug}/g/not-a-real-token`).expect(404);
  });

  it.each([EventVisibility.UNLISTED, EventVisibility.PUBLIC])('shows a %s invitation on its generic link', async (visibility) => {
    const { slug } = await eventWith(visibility);

    const { body } = await http().get(`/api/v1/invitations/${slug}`).expect(200);

    expect(body.guest).toBeNull();
  });

  it('stops showing a cached page once the event is made PRIVATE', async () => {
    const { slug, eventId } = await eventWith(EventVisibility.UNLISTED);
    await http().get(`/api/v1/invitations/${slug}`).expect(200);

    const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.OWNER });

    await http().patch(`/api/v1/events/${eventId}/settings`).set('Authorization', authorization).send({ visibility: 'PRIVATE' }).expect(200);

    await http().get(`/api/v1/invitations/${slug}`).expect(404);
  });
});
