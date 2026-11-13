import { INestApplication } from '@nestjs/common';
import { PlatformRole, PrismaClient, VerificationPurpose } from '@prisma/client';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { accountsApp, http as httpOf } from '../../fixtures/areas/auth-accounts.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const AT = new Date('2026-11-01T09:00:00.000Z');

/**
 * Making and removing Aveline staff (docs/ACCESS_CONTROL.md, "Platform role").
 * A production stack had no way to do it short of editing the database, and
 * data requests, concierge work and access reviews are staff-only.
 */
describe('Staff accounts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => httpOf(app);

  beforeAll(async () => {
    prisma = testPrisma();
    app = await accountsApp(prisma);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  /** A signed-in account with this platform role. */
  const signedIn = async (role: PlatformRole) => {
    const account = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: account.userId }, data: { platformRole: role } });
    return account;
  };

  /** A token of this purpose, spent or not. */
  const token = (userId: string, purpose: VerificationPurpose, isUsed: boolean) =>
    prisma.verificationToken.create({ data: { userId, purpose, tokenHash: `${purpose}-${userId}`, expiresAt: AT, usedAt: isUsed ? AT : null } });

  /** An account someone registered and verified, holding `role`. */
  const registered = async (email: string, role: PlatformRole = PlatformRole.NONE) => {
    const user = await prisma.user.create({ data: { email, name: 'Ani Petrosyan', passwordHash: 'unused', platformRole: role } });
    await token(user.id, VerificationPurpose.EMAIL_VERIFICATION, true);
    return user;
  };
  const roleOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).platformRole;
  const grant = (authorization: string, body: object) => http().post('/api/v1/staff').set('Authorization', authorization).send(body);
  const revoke = (authorization: string, userId: string) => http().delete(`/api/v1/staff/${userId}`).set('Authorization', authorization);

  describe('who may manage staff', () => {
    it.each([PlatformRole.SUPPORT, PlatformRole.NONE])('refuses %s on every staff route', async (role) => {
      const { authorization } = await signedIn(role);
      const target = await registered('ani@example.am', PlatformRole.SUPPORT);

      await http().get('/api/v1/staff').set('Authorization', authorization).expect(403);
      await grant(authorization, { email: 'ani@example.am', role: 'ADMIN' }).expect(403);
      await revoke(authorization, target.id).expect(403);
      expect(await roleOf(target.id)).toBe(PlatformRole.SUPPORT);
    });

    it.each([
      ['GET', () => http().get('/api/v1/staff')],
      ['POST', () => http().post('/api/v1/staff').send({ email: 'ani@example.am', role: 'ADMIN' })],
      ['DELETE', () => http().delete('/api/v1/staff/some-user')],
    ])('refuses %s from a caller who is not signed in', async (_method, call) => {
      await call().expect(401);
    });

    it('refuses an admin revoked while their request waited, so two admins cannot remove each other', async () => {
      const first = await signedIn(PlatformRole.ADMIN);
      const second = await signedIn(PlatformRole.ADMIN);

      const statuses = await Promise.all([revoke(first.authorization, second.userId), revoke(second.authorization, first.userId)]);

      expect(statuses.map(({ status }) => status).sort()).toEqual([204, 403]);
      expect(await prisma.user.count({ where: { platformRole: PlatformRole.ADMIN } })).toBe(1);
    });
  });

  describe('granting', () => {
    it.each([PlatformRole.SUPPORT, PlatformRole.ADMIN])('makes a verified account %s, found by its address in any case, and records who did it', async (role) => {
      const admin = await signedIn(PlatformRole.ADMIN);
      const target = await registered('ani@example.am');

      const { body } = await grant(admin.authorization, { email: ' Ani@Example.AM ', role }).expect(200);

      expect(body).toEqual({ userId: target.id, email: 'ani@example.am', name: 'Ani Petrosyan', role });
      expect(await roleOf(target.id)).toBe(role);
      expect(await prisma.staffRoleChange.findMany({ select: { actorUserId: true, subjectUserId: true, previousRole: true, role: true, source: true } }))
        .toEqual([{ actorUserId: admin.userId, subjectUserId: target.id, previousRole: 'NONE', role, source: 'API' }]);
    });

    it.each([
      [PlatformRole.SUPPORT, PlatformRole.ADMIN],
      [PlatformRole.ADMIN, PlatformRole.SUPPORT],
    ])('changes a %s to %s', async (from, to) => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);
      const target = await registered('ani@example.am', from);

      await grant(authorization, { email: 'ani@example.am', role: to }).expect(200);

      expect(await roleOf(target.id)).toBe(to);
      expect(await prisma.staffRoleChange.findMany({ select: { previousRole: true, role: true } })).toEqual([{ previousRole: from, role: to }]);
    });

    it('records nothing when the account already holds the role', async () => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);
      await registered('ani@example.am', PlatformRole.SUPPORT);

      const { body } = await grant(authorization, { email: 'ani@example.am', role: 'SUPPORT' }).expect(200);

      expect(body).toMatchObject({ role: 'SUPPORT' });
      expect(await prisma.staffRoleChange.count()).toBe(0);
    });

    it('lists active staff in address order, never customers, deactivated or erased accounts', async () => {
      const { authorization, userId } = await signedIn(PlatformRole.ADMIN);
      const { email: adminEmail } = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const support = await registered('ani@example.am', PlatformRole.SUPPORT);
      const second = await registered('aram@example.am', PlatformRole.ADMIN);
      await registered('customer@example.am');
      await prisma.user.update({ where: { id: (await registered('gone@example.am', PlatformRole.SUPPORT)).id }, data: { isActive: false } });
      await prisma.user.update({ where: { id: (await registered('erased@example.am', PlatformRole.ADMIN)).id }, data: { deletedAt: AT } });

      const { body } = await http().get('/api/v1/staff').set('Authorization', authorization).expect(200);

      const expected = [
        { userId: support.id, email: 'ani@example.am', role: 'SUPPORT' },
        { userId: second.id, email: 'aram@example.am', role: 'ADMIN' },
        { userId, email: adminEmail, role: 'ADMIN' },
      ].sort((a, b) => a.email.localeCompare(b.email));
      expect((body as { items: object[] }).items).toEqual(expected.map((row): unknown => expect.objectContaining(row)));
    });

    it.each([
      ['no verification at all', () => Promise.resolve()],
      ['a verification link never opened', (id: string) => token(id, VerificationPurpose.EMAIL_VERIFICATION, false)],
      ['only a spent password reset', (id: string) => token(id, VerificationPurpose.PASSWORD_RESET, true)],
    ])('refuses an account with %s, with a code', async (_case, arrange) => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);
      const target = await prisma.user.create({ data: { email: 'ani@example.am', name: 'Ani', passwordHash: 'unused' } });
      await arrange(target.id);

      const { body } = await grant(authorization, { email: 'ani@example.am', role: 'SUPPORT' }).expect(409);

      expect(body).toMatchObject({ code: 'STAFF_EMAIL_UNVERIFIED' });
      expect(await roleOf(target.id)).toBe(PlatformRole.NONE);
    });

    it.each([
      ['no account', () => Promise.resolve()],
      ['a deactivated account', async () => { await prisma.user.update({ where: { id: (await registered('ani@example.am')).id }, data: { isActive: false } }); }],
      ['an erased account', async () => { await prisma.user.update({ where: { id: (await registered('ani@example.am')).id }, data: { deletedAt: AT } }); }],
    ])('404s an address with %s, with a code', async (_case, arrange) => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);
      await arrange();

      const { body } = await grant(authorization, { email: 'ani@example.am', role: 'SUPPORT' }).expect(404);

      expect(body).toMatchObject({ code: 'STAFF_ACCOUNT_NOT_FOUND' });
    });

    /** 200 characters, every label within the 63 an address allows. */
    const longest = `${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(10)}.am`;
    it.each([
      [{ email: 'ani@example.am', role: 'NONE' }, 'role'],
      [{ email: 'ani@example.am', role: 'admin' }, 'role'],
      [{ email: 'ani@example.am' }, 'role'],
      [{ email: 'not-an-address', role: 'SUPPORT' }, 'email'],
      [{ email: `${longest}m`, role: 'SUPPORT' }, 'email'],
      [{ role: 'SUPPORT' }, 'email'],
    ])('400s %p, naming %s', async (payload, field) => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);

      const { body } = await grant(authorization, payload).expect(400);

      expect(JSON.stringify(body.message)).toContain(field);
    });

    it('accepts an address at the 200-character limit', async () => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);
      expect(longest).toHaveLength(200);

      await grant(authorization, { email: longest, role: 'SUPPORT' }).expect(404);
    });

    it('refuses to change the caller’s own role, so an admin cannot demote themselves by mistake', async () => {
      const { authorization, userId } = await signedIn(PlatformRole.ADMIN);
      const { email } = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

      const { body } = await grant(authorization, { email, role: 'SUPPORT' }).expect(409);

      expect(body).toMatchObject({ code: 'STAFF_SELF_CHANGE' });
      expect(await roleOf(userId)).toBe(PlatformRole.ADMIN);
    });
  });

  describe('revoking', () => {
    it('returns staff to a customer account, effective on its next request', async () => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);
      const support = await signedIn(PlatformRole.SUPPORT);
      await http().get('/api/v1/concierge/organizations').set('Authorization', support.authorization).expect(200);

      await revoke(authorization, support.userId).expect(204);

      expect(await roleOf(support.userId)).toBe(PlatformRole.NONE);
      await http().get('/api/v1/concierge/organizations').set('Authorization', support.authorization).expect(403);
    });

    it.each([PlatformRole.SUPPORT, PlatformRole.ADMIN])('revokes a %s and records it', async (role) => {
      const admin = await signedIn(PlatformRole.ADMIN);
      const target = await registered('ani@example.am', role);

      await revoke(admin.authorization, target.id).expect(204);

      expect(await roleOf(target.id)).toBe(PlatformRole.NONE);
      expect(await prisma.staffRoleChange.findMany({ select: { actorUserId: true, previousRole: true, role: true } }))
        .toEqual([{ actorUserId: admin.userId, previousRole: role, role: 'NONE' }]);
    });

    it('is idempotent: revoking an account that is not staff changes and records nothing', async () => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);
      const customer = await registered('customer@example.am');

      await revoke(authorization, customer.id).expect(204);

      expect(await prisma.staffRoleChange.count()).toBe(0);
    });

    it('404s an account that does not exist, with a code', async () => {
      const { authorization } = await signedIn(PlatformRole.ADMIN);

      const { body } = await revoke(authorization, 'no-such-user').expect(404);

      expect(body).toMatchObject({ code: 'STAFF_ACCOUNT_NOT_FOUND' });
    });

    it('refuses to revoke the caller’s own role', async () => {
      const { authorization, userId } = await signedIn(PlatformRole.ADMIN);

      const { body } = await revoke(authorization, userId).expect(409);

      expect(body).toMatchObject({ code: 'STAFF_SELF_CHANGE' });
      expect(await roleOf(userId)).toBe(PlatformRole.ADMIN);
    });
  });
});
