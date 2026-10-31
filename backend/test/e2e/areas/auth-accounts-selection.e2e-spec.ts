import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { accountsApp, http as httpOf } from '../../fixtures/areas/auth-accounts.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Choosing between several organizations with X-Aveline-Organization-Id
 * (docs/API.md "Becoming a tenant"). Several memberships need the
 * single-membership index out of the way, as the controlled cutover removes it;
 * this file drops it on its own test database and puts it back afterwards.
 */
describe('Selecting between several organizations (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => httpOf(app);
  const current = (authorization: string, selection?: string) => {
    const call = http().get('/api/v1/organizations/current').set('Authorization', authorization);
    return selection ? call.set('X-Aveline-Organization-Id', selection) : call;
  };
  const twoTenants = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    const first = await prisma.organization.create({ data: { name: 'First' } });
    const second = await prisma.organization.create({ data: { name: 'Second' } });
    await prisma.organizationMembership.createMany({ data: [
      { userId, organizationId: first.id, role: 'OWNER' },
      { userId, organizationId: second.id, role: 'MEMBER' },
    ] });
    return { authorization, userId, first, second };
  };

  beforeAll(async () => {
    prisma = testPrisma();
    await prisma.$executeRaw`DROP INDEX IF EXISTS "organization_memberships_userId_key"`;
    app = await accountsApp(prisma);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await resetTestDatabase();
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_userId_key" ON organization_memberships("userId")`;
    await disconnectTestDatabase();
  });

  it('asks for a selection when the account has two live memberships', async () => {
    const { authorization } = await twoTenants();

    const response = await current(authorization).expect(409);

    expect(response.body.code).toBe('ORGANIZATION_SELECTION_REQUIRED');
  });

  it('answers for the selected organization with the role held there', async () => {
    const { authorization, second } = await twoTenants();

    const { body } = await current(authorization, second.id).expect(200);

    expect(body).toMatchObject({ id: second.id, name: 'Second' });
    // MEMBER holds no member:manage in Second, though the account owns First.
    await http().get('/api/v1/organizations/current/members').set('Authorization', authorization).set('X-Aveline-Organization-Id', second.id).expect(403);
  });

  it('refuses the closed one of two organizations and defaults to the one still open', async () => {
    const { authorization, first, second } = await twoTenants();
    await prisma.organization.update({ where: { id: second.id }, data: { deletedAt: new Date() } });

    const refused = await current(authorization, second.id).expect(403);
    const { body } = await current(authorization).expect(200);

    expect(refused.body.code).toBe('ORGANIZATION_ACCESS_DENIED');
    expect(body.id).toBe(first.id);
  });

  it('refuses a selection whose membership has been revoked, while the other still works', async () => {
    const { authorization, userId, first, second } = await twoTenants();
    await prisma.organizationMembership.delete({ where: { userId_organizationId: { userId, organizationId: first.id } } });

    const refused = await current(authorization, first.id).expect(403);

    expect(refused.body.code).toBe('ORGANIZATION_ACCESS_DENIED');
    await current(authorization, second.id).expect(200);
  });
});
