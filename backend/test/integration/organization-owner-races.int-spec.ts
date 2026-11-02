import { PlatformRole, Prisma } from '@prisma/client';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
function barrier() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}
async function fixture() {
  const organization = await prisma.organization.create({ data: { name: 'Family' } });
  const owner = await prisma.user.create({ data: { email: 'owner@test.local', name: 'Owner' } });
  const target = await prisma.user.create({ data: { email: 'target@test.local', name: 'Target' } });
  const successor = await prisma.user.create({ data: { email: 'successor@test.local', name: 'Successor' } });
  await prisma.organizationMembership.createMany({ data: [{ userId: owner.id, organizationId: organization.id, role: 'OWNER' }, { userId: target.id, organizationId: organization.id, role: 'MEMBER' }] });
  const event = await prisma.event.create({ data: { organizationId: organization.id, title: 'Family', type: 'WEDDING', hostsLabel: 'Family', startsAt: new Date() } });
  await prisma.eventMembership.createMany({ data: [{ eventId: event.id, userId: target.id, role: 'OWNER' }, { eventId: event.id, userId: successor.id, role: 'OWNER' }] });
  return { organization, event, target, successor, actor: { userId: owner.id, email: owner.email, platformRole: PlatformRole.NONE } };
}
function pauseAfterQuery(pattern: string, entered: ReturnType<typeof barrier>, proceed: ReturnType<typeof barrier>) {
  let hasPaused = false;
  const database = { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => prisma.$transaction(async (tx) => {
    const raw = tx.$queryRaw.bind(tx);
    const fenced = new Proxy(tx, { get(target, property) {
      if (property !== '$queryRaw') return Reflect.get(target, property) as unknown;
      return async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const result = await raw(strings, ...values);
        if (!hasPaused && strings.join('').includes(pattern)) { hasPaused = true; entered.release(); await proceed.wait; }
        return result;
      };
    } });
    return callback(fenced);
  }, { timeout: 15_000 }) };
  return new OrganizationsService(database as unknown as PrismaService);
}
async function hasWaitingUserUpdate(): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE%users%'`;
    if (row.count > 0) return true;
  }
  return false;
}

describe('active event owner departure races', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it('rolls departure back when the chosen event successor deactivates before its user lock', async () => {
    const { organization, target, successor, actor } = await fixture();
    const entered = barrier(); const proceed = barrier();
    const service = pauseAfterQuery('SELECT target."eventId"', entered, proceed);
    const removal = service.removeMember(organization.id, actor, { userId: target.id, expectedRevision: 0 });
    await entered.wait;
    await prisma.user.update({ where: { id: successor.id }, data: { isActive: false } });
    proceed.release();
    await expect(removal).rejects.toThrow('handover');
    expect(await prisma.eventMembership.count({ where: { userId: target.id } })).toBe(1);
    expect(await prisma.organizationMembership.count({ where: { userId: target.id } })).toBe(1);
  });
  it('holds deactivation until a departure with a locked active successor commits', async () => {
    const { organization, target, successor, actor } = await fixture();
    const entered = barrier(); const proceed = barrier();
    const service = pauseAfterQuery('SELECT "userId" FROM event_memberships WHERE role', entered, proceed);
    const removal = service.removeMember(organization.id, actor, { userId: target.id, expectedRevision: 0 });
    await entered.wait;
    let hasDeactivated = false;
    const deactivation = prisma.user.update({ where: { id: successor.id }, data: { isActive: false } }).then(() => { hasDeactivated = true; });
    const hasWaited = await hasWaitingUserUpdate();
    try {
      expect(hasWaited).toBe(true);
      expect(hasDeactivated).toBe(false);
    } finally { proceed.release(); }
    await removal;
    await deactivation;
    expect(await prisma.eventMembership.count({ where: { userId: target.id } })).toBe(0);
  });
});
