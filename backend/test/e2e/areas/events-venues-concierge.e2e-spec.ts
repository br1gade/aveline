import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageChannel, OrganizationRole, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The concierge's customer resolution: which organization staff land in for
 * a customer email, when they must choose, what an explicit choice may and
 * may not do, and the staff-only lookup of a customer's organizations.
 */
describe('Concierge customer resolution — coverage (e2e)', () => {
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

  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.designTemplate.create({
      data: { key: 'classic', name: 'Classic', allowedFonts: ['Inter'], supportedBlocks: ['HERO', 'RSVP'] },
    });
    await prisma.messageTemplate.create({
      data: {
        organizationId: null,
        key: 'organization.invite',
        channel: MessageChannel.EMAIL,
        subject: { hy: '{{organizationName}}' },
        body: { hy: '{{organizationName}} {{role}} {{link}}' },
      },
    });
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const staff = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.SUPPORT } });
    return authorization;
  };

  const open = (authorization: string, body: Record<string, unknown>) =>
    http().post('/api/v1/concierge/organizations').set('Authorization', authorization).send(body);

  const resolve = (authorization: string, body: Record<string, unknown>) =>
    http().post('/api/v1/concierge/organizations/resolve-customer').set('Authorization', authorization).send(body);

  /** Anna, a member of each named organization, created a minute apart so their order is known. More than one needs the cutover index dropped. */
  const annaIn = async (names: string[]) => {
    const anna = await prisma.user.create({ data: { email: 'anna@example.am', name: 'Anna' } });
    const organizations = [];
    for (const [index, name] of names.entries()) {
      const organization = await prisma.organization.create({
        data: { name, kind: 'HOST', createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)) },
      });
      await prisma.organizationMembership.create({
        data: { userId: anna.id, organizationId: organization.id, role: OrganizationRole.OWNER },
      });
      organizations.push(organization);
    }
    return organizations;
  };

  /**
   * Anna owns one organization and holds an unexpired OWNER invitation to a
   * second — the two relationships an account can have while memberships are
   * one per account.
   */
  const annaOwnsOneAndIsInvitedToAnother = async () => {
    const [home] = await annaIn(['Anna Home']);
    const studio = await prisma.organization.create({ data: { name: 'Anna Studio', kind: 'HOST' } });
    await prisma.organizationInvite.create({
      data: {
        organizationId: studio.id,
        email: 'anna@example.am',
        role: OrganizationRole.OWNER,
        tokenHash: 'studio-invite-token-hash',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return { home, studio };
  };

  const counts = async () => ({
    organizations: await prisma.organization.count(),
    invites: await prisma.organizationInvite.count(),
    messages: await prisma.message.count(),
  });

  describe('a customer with a pending owner invitation', () => {
    it('resolves a repeat open to the organization already opened, with no second invitation', async () => {
      const authorization = await staff();
      const first = await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }).expect(201);

      const { body } = await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }).expect(201);

      expect(body).toMatchObject({ isExisting: true, invite: null, organization: { id: first.body.organization.id } });
      expect(await counts()).toEqual({ organizations: 1, invites: 1, messages: 1 });
    });

    it('opens a new organization once the earlier invitation has expired', async () => {
      const authorization = await staff();
      const first = await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }).expect(201);
      await prisma.organizationInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 60_000) } });

      const { body } = await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }).expect(201);

      expect(body).toMatchObject({ isExisting: false, invite: { email: 'anna@example.am', role: 'OWNER' } });
      expect(body.organization.id).not.toBe(first.body.organization.id);
      expect(await prisma.organization.count()).toBe(2);
      expect(await prisma.organizationInvite.count()).toBe(2);
    });
  });

  describe('a customer with several organizations', () => {
    it('requires a selection with 409 ORGANIZATION_SELECTION_REQUIRED, and opens nothing', async () => {
      const authorization = await staff();
      await annaOwnsOneAndIsInvitedToAnother();

      const { body } = await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }).expect(409);

      expect(body.code).toBe('ORGANIZATION_SELECTION_REQUIRED');
      expect(await counts()).toEqual({ organizations: 2, invites: 1, messages: 0 });
    });

    it('resolves to whichever of the customer’s own organizations staff select, creating nothing', async () => {
      const authorization = await staff();
      const { home, studio } = await annaOwnsOneAndIsInvitedToAnother();

      const chosenHome = await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am', organizationId: home.id }).expect(201);
      const chosenStudio = await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am', organizationId: studio.id }).expect(201);

      expect(chosenHome.body).toMatchObject({ isExisting: true, invite: null, organization: { id: home.id } });
      expect(chosenStudio.body).toMatchObject({ isExisting: true, invite: null, organization: { id: studio.id } });
      expect(await counts()).toEqual({ organizations: 2, invites: 1, messages: 0 });
    });

    it('refuses an organization the customer has no relationship with, and grants nothing', async () => {
      const authorization = await staff();
      await annaOwnsOneAndIsInvitedToAnother();
      const unrelated = await prisma.organization.create({ data: { name: 'Someone Else', kind: 'HOST' } });

      const { body } = await open(authorization, {
        name: 'Petrosyan Wedding',
        ownerEmail: 'anna@example.am',
        organizationId: unrelated.id,
      }).expect(403);

      expect(body.code).toBe('ORGANIZATION_ACCESS_DENIED');
      expect(await prisma.organizationMembership.count({ where: { organizationId: unrelated.id } })).toBe(0);
      expect(await prisma.organizationInvite.count({ where: { organizationId: unrelated.id } })).toBe(0);
    });
  });

  describe("looking up a customer's organizations", () => {
    // Paging needs one account in several organizations, which the
    // one-membership-per-account index forbids until the revision-3 cutover.
    // Dropped for this block only, as organization-multiple.int-spec does.
    beforeAll(() => prisma.$executeRaw`DROP INDEX IF EXISTS "organization_memberships_userId_key"`);
    afterAll(async () => {
      await resetTestDatabase();
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_userId_key" ON organization_memberships("userId")`;
    });

    it('pages the current memberships with only id, name, kind and createdAt', async () => {
      const authorization = await staff();
      const [home, studio, office] = await annaIn(['Anna Home', 'Anna Studio', 'Anna Office']);

      const first = await resolve(authorization, { ownerEmail: 'anna@example.am', limit: 2 }).expect(201);
      const second = await resolve(authorization, {
        ownerEmail: 'anna@example.am',
        limit: 2,
        cursor: first.body.nextCursor,
      }).expect(201);

      expect((first.body.items as { id: string }[]).map((item) => item.id)).toEqual([home.id, studio.id]);
      for (const item of first.body.items as object[]) {
        expect(Object.keys(item).sort()).toEqual(['createdAt', 'id', 'kind', 'name']);
      }
      expect(first.body.nextCursor).toEqual(expect.any(String));
      expect(second.body).toEqual({
        items: [{ id: office.id, name: 'Anna Office', kind: 'HOST', createdAt: office.createdAt.toISOString() }],
        nextCursor: null,
      });
    });

    it('does not list an organization the customer is only invited to', async () => {
      const authorization = await staff();
      await open(authorization, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }).expect(201);

      const { body } = await resolve(authorization, { ownerEmail: 'anna@example.am' }).expect(201);

      expect(body).toEqual({ items: [], nextCursor: null });
    });

    it.each([
      ['a limit above 50', { limit: 51 }, 'limit'],
      ['a cursor longer than 256 characters', { cursor: 'a'.repeat(257) }, 'cursor'],
    ])('refuses %s with a 400 naming the field', async (_label, payload, field) => {
      const authorization = await staff();

      const { body } = await resolve(authorization, { ownerEmail: 'anna@example.am', ...payload }).expect(400);

      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
    });
  });

  describe('closed to customers', () => {
    it('refuses a customer the lookup and creating an event in an organization', async () => {
      const [home] = await annaIn(['Anna Home']);
      // Even the owner of the organization named in the path is a customer here.
      const { authorization, userId } = await authenticateAs(app, prisma);
      await prisma.organizationMembership.create({ data: { userId, organizationId: home.id, role: OrganizationRole.OWNER } });

      await resolve(authorization, { ownerEmail: 'anna@example.am' }).expect(403);
      await http()
        .post(`/api/v1/concierge/organizations/${home.id}/events`)
        .set('Authorization', authorization)
        .send({ type: 'WEDDING', title: 'Anna & Davit', startsAt: '2027-06-12T15:00:00Z' })
        .expect(403);

      expect(await prisma.event.count()).toBe(0);
    });
  });

  it('refuses to create an event in an organization that does not exist, and creates none', async () => {
    const authorization = await staff();

    const { body } = await http()
      .post('/api/v1/concierge/organizations/cnosuchorganization0000000/events')
      .set('Authorization', authorization)
      .send({ type: 'WEDDING', title: 'Anna & Davit', startsAt: '2027-06-12T15:00:00Z' })
      .expect(403);

    expect(body.code).toBe('ORGANIZATION_ACCESS_DENIED');
    expect(await prisma.event.count()).toBe(0);
  });
});
