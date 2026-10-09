import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageChannel, OrganizationRole, PlatformRole, PrismaClient, SuppressionReason } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Who may see and do what across organizations — the P1 access bugs, each
 * walked over HTTP: a read-only member making events, an account in two
 * organizations, one person as two accounts, and one customer's data in
 * another's lists.
 */
describe('Access between and within organizations (e2e)', () => {
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

  /** An account in a fresh organization with the given role. */
  const memberOf = async (role: OrganizationRole, organizationId?: string) => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    const organization = organizationId
      ? { id: organizationId }
      : await prisma.organization.create({ data: { name: `Org ${randomUUID().slice(0, 4)}`, kind: 'HOST' } });
    await prisma.organizationMembership.create({ data: { userId, organizationId: organization.id, role } });
    return { authorization, userId, organizationId: organization.id };
  };

  const newEvent = (authorization: string) =>
    http()
      .post('/api/v1/events')
      .set('Authorization', authorization)
      .send({ type: 'WEDDING', title: 'A & B', startsAt: '2027-06-12T15:00:00Z' });

  describe('making events', () => {
    // B13: POST /events required no permission, so a read-only member made one and became its owner.
    it.each([OrganizationRole.VIEWER, OrganizationRole.MEMBER])('refuses an organization %s', async (role) => {
      const { authorization } = await memberOf(role);

      await newEvent(authorization).expect(403);
    });

    it.each([OrganizationRole.OWNER, OrganizationRole.MANAGER])('lets an organization %s', async (role) => {
      const { authorization } = await memberOf(role);

      await newEvent(authorization).expect(201);
    });
  });

  // D9 (decided 10 October 2026): a MANAGER who creates an event runs it
  // but does not own it — deleting it and managing its team stay with the
  // organization's owner, as ACCESS_CONTROL says.
  describe('who an event\'s creator becomes', () => {
    const created = async (role: OrganizationRole) => {
      const member = await memberOf(role);
      const { body } = await newEvent(member.authorization).expect(201);
      const membership = await prisma.eventMembership.findFirstOrThrow({ where: { eventId: body.id as string, userId: member.userId } });
      return { ...member, eventId: body.id as string, role: membership.role };
    };

    it('makes a MANAGER its coordinator, who cannot delete it or manage its team', async () => {
      const { authorization, eventId, role } = await created(OrganizationRole.MANAGER);

      expect(role).toBe('COORDINATOR');
      await http().patch(`/api/v1/events/${eventId}`).set('Authorization', authorization).send({ title: 'Renamed' }).expect(200);
      await http().post(`/api/v1/events/${eventId}/archive`).set('Authorization', authorization).expect(403);
      await http().post(`/api/v1/events/${eventId}/team/invites`).set('Authorization', authorization).send({ email: 'x@test.local', role: 'OWNER' }).expect(403);
    });

    it('makes the organization\'s OWNER its owner', async () => {
      const { role } = await created(OrganizationRole.OWNER);

      expect(role).toBe('OWNER');
    });
  });

  describe('one organization per account (B14)', () => {
    it('opens only one organization when asked several times at once', async () => {
      const { authorization, userId } = await authenticateAs(app, prisma);

      const statuses = await Promise.all(
        ['One', 'Two', 'Three'].map(async (name) =>
          (await http().post('/api/v1/organizations').set('Authorization', authorization).send({ name: `${name} Org` })).status,
        ),
      );

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(2);
      expect(await prisma.organizationMembership.count({ where: { userId } })).toBe(1);
    });

    it('refuses an invitation into a second organization, saying which one they are in', async () => {
      const owner = await memberOf(OrganizationRole.OWNER);
      await prisma.messageTemplate.create({
        data: { organizationId: null, key: 'organization.invite', channel: MessageChannel.EMAIL, body: { hy: '{{link}} {{organizationName}} {{role}}' } },
      });
      const invited = await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', owner.authorization)
        .send({ email: 'ani@example.am', role: 'MEMBER' })
        .expect(201);
      await http().post('/api/v1/auth/register').send({ email: 'ani@example.am', password: 'a-long-enough-password', name: 'Ani' }).expect(201);
      const ani = await prisma.user.findFirstOrThrow({ where: { email: 'ani@example.am' } });
      const theirs = await prisma.organization.create({ data: { name: 'Ani’s Own', kind: 'HOST' } });
      await prisma.organizationMembership.create({ data: { userId: ani.id, organizationId: theirs.id, role: OrganizationRole.OWNER } });
      const token = new URL((invited.body as { devLink: string }).devLink).searchParams.get('token');

      const { body } = await http()
        .post('/api/v1/invites/accept')
        .send({ token, name: 'Ani', password: 'a-long-enough-password' })
        .expect(409);

      expect(body.message).toContain('Ani’s Own');
    });
  });

  describe('one account per email, whatever the capitals (B15)', () => {
    it('signs in with any capitals, and refuses a second account that differs only in case', async () => {
      await http().post('/api/v1/auth/register').send({ email: ' Ani@Example.AM ', password: 'a-long-enough-password', name: 'Ani' }).expect(201);

      await http().post('/api/v1/auth/login').send({ email: 'ani@example.am', password: 'a-long-enough-password' }).expect(201);
      await http().post('/api/v1/auth/login').send({ email: 'ANI@EXAMPLE.AM', password: 'a-long-enough-password' }).expect(201);
      await http().post('/api/v1/auth/register').send({ email: 'ani@example.am', password: 'another-long-password', name: 'Ani 2' }).expect(401);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('suppressions (B17)', () => {
    it('shows a host their own, and the platform ones that touch their guests — no one else’s', async () => {
      const { eventId } = await seedEvent(prisma);
      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      const host = await memberOf(OrganizationRole.OWNER, event.organizationId);
      await prisma.guest.updateMany({ where: { eventId }, data: { email: 'our-guest@example.am' } });
      const elsewhere = await prisma.organization.create({ data: { name: 'Elsewhere', kind: 'HOST' } });
      await prisma.suppression.createMany({
        data: [
          { organizationId: event.organizationId, channel: MessageChannel.EMAIL, address: 'unsubscribed@example.am', reason: SuppressionReason.UNSUBSCRIBED },
          { organizationId: null, channel: MessageChannel.EMAIL, address: 'our-guest@example.am', reason: SuppressionReason.HARD_BOUNCE },
          { organizationId: null, channel: MessageChannel.EMAIL, address: 'a-stranger@example.am', reason: SuppressionReason.HARD_BOUNCE },
          { organizationId: elsewhere.id, channel: MessageChannel.EMAIL, address: 'their-guest@example.am', reason: SuppressionReason.UNSUBSCRIBED },
        ],
      });

      const { body } = await http().get('/api/v1/suppressions').set('Authorization', host.authorization).expect(200);

      expect((body as { address: string }[]).map((row) => row.address).sort()).toEqual([
        'our-guest@example.am',
        'unsubscribed@example.am',
      ]);
    });
  });

  describe('vendors (B12; decided 9 October 2026)', () => {
    it('keeps an organization’s own vendors to itself, and shows everyone Aveline’s list', async () => {
      const a = await memberOf(OrganizationRole.OWNER);
      const b = await memberOf(OrganizationRole.OWNER);
      const staff = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: PlatformRole.SUPPORT } });

      await http()
        .post('/api/v1/vendors')
        .set('Authorization', a.authorization)
        .send({ name: 'Cousin Aram, photographer', category: 'PHOTOGRAPHY', phone: '+37491000000' })
        .expect(201);
      await http()
        .post('/api/v1/vendors')
        .set('Authorization', staff.authorization)
        .send({ name: 'Garden Catering', category: 'CATERING' })
        .expect(201);

      const listFor = async (authorization: string) =>
        ((await http().get('/api/v1/vendors').set('Authorization', authorization).expect(200)).body as { name: string; isCurated: boolean }[]).map(
          (vendor) => `${vendor.name}${vendor.isCurated ? ' (Aveline)' : ''}`,
        );
      expect((await listFor(a.authorization)).sort()).toEqual(['Cousin Aram, photographer', 'Garden Catering (Aveline)']);
      expect(await listFor(b.authorization)).toEqual(['Garden Catering (Aveline)']);
    });

    it('will not book another organization’s vendor', async () => {
      const a = await memberOf(OrganizationRole.OWNER);
      const { eventId } = await seedEvent(prisma);
      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      const b = await memberOf(OrganizationRole.OWNER, event.organizationId);
      const theirs = await http()
        .post('/api/v1/vendors')
        .set('Authorization', a.authorization)
        .send({ name: 'Cousin Aram', category: 'PHOTOGRAPHY' })
        .expect(201);

      await http()
        .post(`/api/v1/events/${eventId}/vendors`)
        .set('Authorization', b.authorization)
        .send({ vendorId: theirs.body.id })
        .expect(404);
    });
  });
});
