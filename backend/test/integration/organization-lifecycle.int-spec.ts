import { OrganizationRole, PlatformRole } from '@prisma/client';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
const service = new OrganizationsService(prisma as PrismaService);
async function fixture(role: OrganizationRole = 'MEMBER') {
  const organization = await prisma.organization.create({ data: { name: 'Family' } });
  const owner = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner' } });
  const member = await prisma.user.create({ data: { email: 'member@example.test', name: 'Member' } });
  await prisma.organizationMembership.createMany({ data: [
    { userId: owner.id, organizationId: organization.id, role: 'OWNER' },
    { userId: member.id, organizationId: organization.id, role },
  ] });
  return { organization, owner, member, actor: { userId: owner.id, email: owner.email, platformRole: PlatformRole.NONE } };
}

describe('organization lifecycle', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it('rolls back departure when a direct event still needs owner handover', async () => {
    const { organization, owner, member, actor } = await fixture();
    const event = await prisma.event.create({ data: { organizationId: organization.id, title: 'Family', type: 'WEDDING', hostsLabel: 'Family', startsAt: new Date() } });
    await prisma.eventMembership.create({ data: { eventId: event.id, userId: member.id, role: 'OWNER' } });
    await expect(service.removeMember(organization.id, actor, { userId: member.id, expectedRevision: 0 })).rejects.toThrow('handover');
    expect(await prisma.organizationMembership.count()).toBe(2);
    expect(await prisma.eventMembership.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
  });
  it('removes every target-org direct role and preserves an unrelated event grant', async () => {
    const { organization, member, actor } = await fixture();
    const other = await prisma.organization.create({ data: { name: 'Other' } });
    const events = await Promise.all([organization.id, organization.id, other.id].map((organizationId) => prisma.event.create({ data: { organizationId, title: 'Event', type: 'WEDDING', hostsLabel: 'Family', startsAt: new Date() } })));
    await prisma.eventMembership.createMany({ data: events.map((event, index) => ({ eventId: event.id, userId: member.id, role: index === 0 ? 'DESIGNER' : 'VIEWER' })) });
    await service.removeMember(organization.id, actor, { userId: member.id, expectedRevision: 0 });
    expect(await prisma.eventMembership.findMany({ where: { userId: member.id }, select: { eventId: true } })).toEqual([{ eventId: events[2].id }]);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).accessRevision).toBe(1);
  });
  it('rejects a stale membership mutation without changing roles', async () => {
    const { organization, member, actor } = await fixture();
    await expect(service.changeMember(organization.id, actor, { userId: member.id, role: 'OWNER', expectedRevision: 1 })).rejects.toThrow('revision');
    expect((await prisma.organizationMembership.findUniqueOrThrow({ where: { userId: member.id } })).role).toBe('MEMBER');
  });
});
