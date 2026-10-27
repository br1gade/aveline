import { PlatformRole } from '@prisma/client';
import { EventsService } from '../../src/modules/events/events.service';
import { AuditService } from '../../src/infra/audit/audit.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { StorageService } from '../../src/infra/storage/storage.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RequestActor } from '../../src/infra/auth/actor';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
const events = new EventsService(prisma as PrismaService, {} as AuditService, {} as CacheService, {} as StorageService);
async function fixture(platformRole: PlatformRole) {
  const user = await prisma.user.create({ data: { email: 'member@test.local', name: 'Member', platformRole } });
  const organizations = await Promise.all(['Selected', 'Direct', 'Foreign'].map((name) => prisma.organization.create({ data: { name } })));
  await prisma.organizationMembership.create({ data: { organizationId: organizations[0].id, userId: user.id, role: 'OWNER' } });
  const created = await Promise.all(organizations.map((organization) => prisma.event.create({ data: { organizationId: organization.id, title: organization.name, type: 'WEDDING', hostsLabel: 'Family', startsAt: new Date() } })));
  await prisma.eventMembership.create({ data: { eventId: created[1].id, userId: user.id, role: 'DESIGNER' } });
  const actor: RequestActor = { userId: user.id, email: user.email, platformRole, organizationId: organizations[0].id, organizationRole: 'OWNER',
    organizationContext: { organizationId: organizations[0].id, organizationRole: 'OWNER', access: 'membership', source: 'header' } };
  return { actor, created };
}

describe('selected organization event list compatibility', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it.each([PlatformRole.NONE, PlatformRole.SUPPORT])('%s keeps independent direct grants but excludes foreign events without grants', async (role) => {
    const { actor, created } = await fixture(role);
    const result = await events.findAll(actor);
    expect(new Set(result.map((event) => event.id))).toEqual(new Set([created[0].id, created[1].id]));
    expect(result.map((event) => event.id)).not.toContain(created[2].id);
  });
  it('keeps legacy sole-membership plus direct grants and staff global lists without a header', async () => {
    const { actor, created } = await fixture(PlatformRole.SUPPORT);
    const legacy = { ...actor, platformRole: PlatformRole.NONE, organizationContext: { ...actor.organizationContext!, source: 'sole-membership' as const } };
    expect(new Set((await events.findAll(legacy)).map((event) => event.id))).toEqual(new Set([created[0].id, created[1].id]));
    const global = { ...actor, organizationContext: null, organizationId: null, organizationRole: null };
    expect((await events.findAll(global)).map((event) => event.id)).toHaveLength(3);
  });
});
