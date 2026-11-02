import { PlatformRole } from '@prisma/client';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
const organizations = new OrganizationsService(prisma as PrismaService);

describe('transactional organization authority evidence', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it('records only IDs and role transitions with the same committed access revision', async () => {
    const organization = await prisma.organization.create({ data: { name: 'Family' } });
    const owner = await prisma.user.create({ data: { email: 'owner@test.local', name: 'Owner' } });
    const member = await prisma.user.create({ data: { email: 'member@test.local', name: 'Member' } });
    await prisma.organizationMembership.createMany({ data: [{ organizationId: organization.id, userId: owner.id, role: 'OWNER' }, { organizationId: organization.id, userId: member.id, role: 'MEMBER' }] });
    const actor = { userId: owner.id, email: owner.email, platformRole: PlatformRole.NONE };
    await organizations.changeMember(organization.id, actor, { userId: member.id, role: 'MANAGER', expectedRevision: 0 });
    await organizations.removeMember(organization.id, actor, { userId: member.id, expectedRevision: 1 });
    const records = await prisma.$queryRaw<{ actorUserId: string; subjectUserId: string; action: string; previousRole: string; role: string | null; accessRevision: number }[]>`
      SELECT "actorUserId", "subjectUserId", action, "previousRole", role, "accessRevision"
      FROM organization_access_changes WHERE "organizationId" = ${organization.id} ORDER BY "accessRevision"`;
    expect(records).toEqual([
      { actorUserId: owner.id, subjectUserId: member.id, action: 'ROLE_CHANGED', previousRole: 'MEMBER', role: 'MANAGER', accessRevision: 1 },
      { actorUserId: owner.id, subjectUserId: member.id, action: 'REMOVED', previousRole: 'MANAGER', role: null, accessRevision: 2 },
    ]);
  });
});
