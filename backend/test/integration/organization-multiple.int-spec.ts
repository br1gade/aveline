import { PlatformRole } from '@prisma/client';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { resolveOrganizationContext } from '../../src/infra/auth/organization-context';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
const organizations = new OrganizationsService(prisma as PrismaService);

describe('controlled multiple-organization cutover', () => {
  beforeAll(async () => {
    await prisma.$executeRaw`DROP INDEX IF EXISTS "organization_memberships_userId_key"`;
  });
  beforeEach(resetTestDatabase);
  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_userId_key" ON organization_memberships("userId")`;
    await disconnectTestDatabase();
  });
  it('keeps additional creation disabled after index cutover until the shared gate enables it', async () => {
    const user = await prisma.user.create({ data: { email: 'member@example.test', name: 'Member' } });
    await organizations.create(user.id, { name: 'First' }, 'first');
    await expect(organizations.create(user.id, { name: 'Second' }, 'second')).rejects.toThrow('one organization');
    await prisma.runtimeCompatibility.update({ where: { id: 'organization-context' }, data: { multiOrganizationWrites: true } });
    const second = await organizations.create(user.id, { name: 'Second' }, 'second');
    await expect(organizations.create(user.id, { name: 'Second' }, 'second')).resolves.toMatchObject({ id: second.id });
    expect(await prisma.organizationMembership.count({ where: { userId: user.id } })).toBe(2);
  });
  it('uses only the exact selected role and preserves another organization when leaving', async () => {
    const user = await prisma.user.create({ data: { email: 'member@example.test', name: 'Member' } });
    const otherOwner = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner' } });
    const first = await prisma.organization.create({ data: { name: 'First' } });
    const second = await prisma.organization.create({ data: { name: 'Second' } });
    await prisma.organizationMembership.createMany({ data: [
      { userId: user.id, organizationId: first.id, role: 'OWNER' },
      { userId: user.id, organizationId: second.id, role: 'MANAGER' },
      { userId: otherOwner.id, organizationId: first.id, role: 'OWNER' },
    ] });
    const actor = { userId: user.id, email: user.email, platformRole: PlatformRole.NONE };
    await expect(resolveOrganizationContext(prisma, { ...actor, mode: 'required' })).rejects.toThrow('select an organization');
    await expect(resolveOrganizationContext(prisma, { ...actor, mode: 'required', selector: second.id })).resolves.toMatchObject({ organizationRole: 'MANAGER' });
    await organizations.removeMember(first.id, actor, { userId: user.id, expectedRevision: 0 });
    expect(await prisma.organizationMembership.findMany({ where: { userId: user.id }, select: { organizationId: true, role: true } })).toEqual([{ organizationId: second.id, role: 'MANAGER' }]);
  });
});
