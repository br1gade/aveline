import { INestApplication } from '@nestjs/common';
import { OrganizationRole, PrismaClient } from '@prisma/client';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { accountsApp, http as httpOf, memberOf } from '../../fixtures/areas/auth-accounts.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Becoming a tenant and running its membership over HTTP
 * (docs/API.md "Becoming a tenant — do this once, first").
 */
describe('Organization tenancy and membership (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => httpOf(app);
  const roleOf = async (organizationId: string, userId: string) =>
    (await prisma.organizationMembership.findUniqueOrThrow({ where: { userId_organizationId: { userId, organizationId } } })).role;
  const revisionOf = async (organizationId: string) =>
    (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).accessRevision;
  const tenant = async (roles: OrganizationRole[] = ['MEMBER']) => {
    const organization = await prisma.organization.create({ data: { name: 'Family' } });
    const owner = await memberOf(app, prisma, organization.id, 'OWNER');
    const members = [];
    for (const role of roles) members.push(await memberOf(app, prisma, organization.id, role));
    return { organization, owner, members };
  };

  beforeAll(async () => {
    prisma = testPrisma();
    app = await accountsApp(prisma);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  describe('creating an organization with an Idempotency-Key', () => {
    const create = (authorization: string, key: string, name: string) =>
      http().post('/api/v1/organizations').set('Authorization', authorization).set('Idempotency-Key', key).send({ name });

    it('replays the same organization for the same key and body, creating it once', async () => {
      const { authorization } = await authenticateAs(app, prisma);
      const first = await create(authorization, 'k1', 'Alpha Family').expect(201);

      const again = await create(authorization, 'k1', 'Alpha Family').expect(201);

      expect(again.body.id).toBe(first.body.id);
      expect(await prisma.organization.count()).toBe(1);
      expect(await prisma.organizationMembership.count()).toBe(1);
    });

    it('refuses the same key with a different body as IDEMPOTENCY_KEY_REUSED and creates nothing', async () => {
      const { authorization } = await authenticateAs(app, prisma);
      await create(authorization, 'k1', 'Alpha Family').expect(201);

      const response = await create(authorization, 'k1', 'Beta Family').expect(409);

      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await prisma.organization.findMany({ select: { name: true } })).toEqual([{ name: 'Alpha Family' }]);
    });

    it.each(['bad key!', 'k'.repeat(121), 'semi;colon'])('refuses the malformed key %p naming the header and creates nothing', async (key) => {
      const { authorization } = await authenticateAs(app, prisma);

      const response = await create(authorization, key, 'Alpha Family').expect(400);

      expect(String(response.body.message)).toMatch(/^Idempotency-Key:/);
      expect(await prisma.organization.count()).toBe(0);
    });

    it('accepts a key of exactly 120 characters', async () => {
      const { authorization } = await authenticateAs(app, prisma);

      await create(authorization, 'k'.repeat(120), 'Alpha Family').expect(201);
    });

    it('does not replay another account’s organization for the same key', async () => {
      const first = await authenticateAs(app, prisma);
      const second = await authenticateAs(app, prisma);
      const mine = await create(first.authorization, 'shared', 'Alpha Family').expect(201);

      const theirs = await create(second.authorization, 'shared', 'Alpha Family').expect(201);

      expect(theirs.body.id).not.toBe(mine.body.id);
    });
  });

  describe('selecting an organization with one membership', () => {
    const current = (authorization: string, selection?: string) => {
      const call = http().get('/api/v1/organizations/current').set('Authorization', authorization);
      return selection ? call.set('X-Aveline-Organization-Id', selection) : call;
    };

    it('refuses a selection of a closed organization the caller still has a membership row in', async () => {
      const { organization, members: [member] } = await tenant();
      await current(member.authorization, organization.id).expect(200);
      await prisma.organization.update({ where: { id: organization.id }, data: { deletedAt: new Date() } });

      const response = await current(member.authorization, organization.id).expect(403);

      expect(response.body.code).toBe('ORGANIZATION_ACCESS_DENIED');
    });

    it('does not default to a closed organization when no selection is given', async () => {
      const { organization, members: [member] } = await tenant();
      await prisma.organization.update({ where: { id: organization.id }, data: { deletedAt: new Date() } });

      const response = await current(member.authorization).expect(403);

      expect(response.body.code).toBe('ORGANIZATION_ACCESS_DENIED');
    });

    it('refuses a selection of an organization the caller has since left', async () => {
      const { organization, members: [member] } = await tenant();
      await http().post('/api/v1/organizations/current/leave').set('Authorization', member.authorization).send({ expectedRevision: 0 }).expect(201);

      const response = await current(member.authorization, organization.id).expect(403);

      expect(response.body.code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });

  describe('listing members', () => {
    const page = (authorization: string, query: string) =>
      http().get(`/api/v1/organizations/current/members?${query}`).set('Authorization', authorization);

    it('returns each member’s id, name, role and joinedAt only, with the access revision', async () => {
      const { owner, members: [member] } = await tenant();
      const byUserId = (a: { userId: string }, b: { userId: string }) => a.userId.localeCompare(b.userId);

      const { body } = await page(owner.authorization, 'limit=10').expect(200);

      expect([...(body.items as { userId: string }[])].sort(byUserId)).toEqual([
        { userId: owner.userId, name: 'Test User', role: 'OWNER', joinedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
        { userId: member.userId, name: 'Test User', role: 'MEMBER', joinedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
      ].sort(byUserId));
      expect(body.accessRevision).toBe(0);
      expect(body.nextCursor).toBeNull();
      expect(JSON.stringify(body)).not.toContain('@aveline.test');
    });

    it('moves the listed access revision on after a role change', async () => {
      const { owner, members: [member] } = await tenant();
      await http().patch(`/api/v1/organizations/current/members/${member.userId}`).set('Authorization', owner.authorization)
        .send({ role: 'MANAGER', expectedRevision: 0 }).expect(200);

      const { body } = await page(owner.authorization, 'limit=10').expect(200);

      expect(body.accessRevision).toBe(1);
    });

    it('pages through every member exactly once', async () => {
      const { owner, members } = await tenant(['MEMBER', 'VIEWER']);
      const seen: string[] = [];

      let cursor: string | null = null;
      for (let call = 0; call < 4 && (call === 0 || cursor); call++) {
        const { body } = await page(owner.authorization, cursor ? `limit=1&cursor=${encodeURIComponent(cursor)}` : 'limit=1').expect(200);
        seen.push(...(body.items as { userId: string }[]).map((item) => item.userId));
        cursor = body.nextCursor as string | null;
      }

      expect(seen.sort()).toEqual([owner.userId, ...members.map((member) => member.userId)].sort());
      expect(cursor).toBeNull();
    });

    it.each(['MANAGER', 'MEMBER', 'VIEWER'] as const)('refuses a %s', async (role) => {
      const { members: [member] } = await tenant([role]);

      await page(member.authorization, 'limit=10').expect(403);
    });

    it.each(['limit=0', 'limit=101'])('refuses %s naming the limit', async (query) => {
      const { owner } = await tenant();

      const response = await page(owner.authorization, query).expect(400);

      expect(response.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'limit' })]));
    });
  });

  describe('changing a member’s role', () => {
    const change = (authorization: string, userId: string, body: object) =>
      http().patch(`/api/v1/organizations/current/members/${userId}`).set('Authorization', authorization).send(body);

    it('changes the role and moves the access revision on', async () => {
      const { organization, owner, members: [member] } = await tenant();

      const { body } = await change(owner.authorization, member.userId, { role: 'MANAGER', expectedRevision: 0 }).expect(200);

      expect(body).toEqual({ organizationId: organization.id, userId: member.userId, role: 'MANAGER', accessRevision: 1 });
      expect(await roleOf(organization.id, member.userId)).toBe('MANAGER');
    });

    it('refuses a stale revision as REVISION_CHANGED and leaves the role alone', async () => {
      const { organization, owner, members: [member] } = await tenant();
      await change(owner.authorization, member.userId, { role: 'MANAGER', expectedRevision: 0 }).expect(200);

      const response = await change(owner.authorization, member.userId, { role: 'VIEWER', expectedRevision: 0 }).expect(409);

      expect(response.body.code).toBe('REVISION_CHANGED');
      expect(await roleOf(organization.id, member.userId)).toBe('MANAGER');
      expect(await revisionOf(organization.id)).toBe(1);
    });

    it('refuses demoting the last active owner as OWNER_HANDOVER_REQUIRED', async () => {
      const { organization, owner } = await tenant();

      const response = await change(owner.authorization, owner.userId, { role: 'MEMBER', expectedRevision: 0 }).expect(409);

      expect(response.body.code).toBe('OWNER_HANDOVER_REQUIRED');
      expect(await roleOf(organization.id, owner.userId)).toBe('OWNER');
      expect(await revisionOf(organization.id)).toBe(0);
    });

    it('counts a deactivated co-owner as no successor', async () => {
      const { organization, owner, members: [other] } = await tenant(['OWNER']);
      await prisma.user.update({ where: { id: other.userId }, data: { isActive: false } });

      const response = await change(owner.authorization, owner.userId, { role: 'MEMBER', expectedRevision: 0 }).expect(409);

      expect(response.body.code).toBe('OWNER_HANDOVER_REQUIRED');
      expect(await roleOf(organization.id, owner.userId)).toBe('OWNER');
    });

    it('lets an owner step down when another active owner remains', async () => {
      const { organization, owner, members: [other] } = await tenant(['OWNER']);

      await change(owner.authorization, owner.userId, { role: 'MEMBER', expectedRevision: 0 }).expect(200);

      expect(await roleOf(organization.id, owner.userId)).toBe('MEMBER');
      expect(await roleOf(organization.id, other.userId)).toBe('OWNER');
    });

    it('refuses a viewer changing roles', async () => {
      const { organization, members: [viewer, member] } = await tenant(['VIEWER', 'MEMBER']);

      await change(viewer.authorization, member.userId, { role: 'MANAGER', expectedRevision: 0 }).expect(403);

      expect(await roleOf(organization.id, member.userId)).toBe('MEMBER');
    });

    it('names the role field when it is not a role', async () => {
      const { owner, members: [member] } = await tenant();

      const response = await change(owner.authorization, member.userId, { role: 'EMPEROR', expectedRevision: 0 }).expect(400);

      expect(response.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'role' })]));
    });

    it.each([
      { label: 'removing', send: (authorization: string, userId: string) => http().delete(`/api/v1/organizations/current/members/${userId}?expectedRevision=0`).set('Authorization', authorization) },
      { label: 'leaving', send: (authorization: string) => http().post('/api/v1/organizations/current/leave').set('Authorization', authorization).send({ expectedRevision: 0 }) },
    ])('refuses the sole owner $label as OWNER_HANDOVER_REQUIRED and keeps the membership', async ({ send }) => {
      const { organization, owner } = await tenant();

      const response = await send(owner.authorization, owner.userId).expect(409);

      expect(response.body.code).toBe('OWNER_HANDOVER_REQUIRED');
      expect(await roleOf(organization.id, owner.userId)).toBe('OWNER');
    });
  });

  describe('promoting a successor owner', () => {
    const transfer = (authorization: string, successorUserId: string, expectedRevision = 0) =>
      http().post('/api/v1/organizations/current/owner-transfers').set('Authorization', authorization).send({ successorUserId, expectedRevision });

    it('makes the successor an owner and leaves the caller an owner', async () => {
      const { organization, owner, members: [member] } = await tenant();

      const { body } = await transfer(owner.authorization, member.userId).expect(201);

      expect(body).toMatchObject({ userId: member.userId, role: 'OWNER', accessRevision: 1 });
      expect(await roleOf(organization.id, member.userId)).toBe('OWNER');
      expect(await roleOf(organization.id, owner.userId)).toBe('OWNER');
    });

    it('answers 404 for a successor who is not a member', async () => {
      const { organization, owner } = await tenant();
      const outsider = await authenticateAs(app, prisma);

      await transfer(owner.authorization, outsider.userId).expect(404);

      expect(await revisionOf(organization.id)).toBe(0);
    });

    it('answers 404 for a deactivated member', async () => {
      const { organization, owner, members: [member] } = await tenant();
      await prisma.user.update({ where: { id: member.userId }, data: { isActive: false } });

      await transfer(owner.authorization, member.userId).expect(404);

      expect(await roleOf(organization.id, member.userId)).toBe('MEMBER');
    });

    it('refuses a stale revision as REVISION_CHANGED', async () => {
      const { organization, owner, members: [member] } = await tenant();

      const response = await transfer(owner.authorization, member.userId, 3).expect(409);

      expect(response.body.code).toBe('REVISION_CHANGED');
      expect(await roleOf(organization.id, member.userId)).toBe('MEMBER');
    });

    it('lets the original owner step down once the successor is an owner', async () => {
      const { organization, owner, members: [member] } = await tenant();
      await transfer(owner.authorization, member.userId).expect(201);

      await http()
        .post('/api/v1/organizations/current/leave')
        .set('Authorization', owner.authorization)
        .send({ expectedRevision: 1 })
        .expect(201);

      expect(await prisma.organizationMembership.findMany({ where: { organizationId: organization.id }, select: { userId: true, role: true } }))
        .toEqual([{ userId: member.userId, role: 'OWNER' }]);
    });
  });

  describe('closure reviews', () => {
    const requestClosure = (authorization: string) =>
      http().post('/api/v1/organizations/current/closure-reviews').set('Authorization', authorization).send({ expectedRevision: 0 });
    const resolve = (authorization: string, reviewId: string, body: object) =>
      http().post(`/api/v1/admin/organization-access-reviews/${reviewId}/resolve`).set('Authorization', authorization).send(body);
    const asAdmin = async (platformRole: 'ADMIN' | 'SUPPORT' = 'ADMIN') => {
      const staff = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: staff.userId }, data: { platformRole } });
      return staff;
    };

    it('refuses SUPPORT the review queue', async () => {
      const { owner } = await tenant();
      await requestClosure(owner.authorization).expect(201);
      const support = await asAdmin('SUPPORT');

      await http().get('/api/v1/admin/organization-access-reviews').set('Authorization', support.authorization).expect(403);
    });

    it('lets an ADMIN close the tenant, after which its former owner is refused', async () => {
      const { organization, owner } = await tenant();
      const { body: review } = await requestClosure(owner.authorization).expect(201);
      const admin = await asAdmin();

      const { body } = await resolve(admin.authorization, review.reviewId as string, { decision: 'CLOSE', expectedRevision: 0 }).expect(201);

      expect(body).toEqual({ reviewId: review.reviewId, status: 'CLOSE', accessRevision: 1 });
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).deletedAt).not.toBeNull();
      await http().get('/api/v1/organizations/current').set('Authorization', owner.authorization).expect(403);
    });
  });
});
