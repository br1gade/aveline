import { PlatformRole, Prisma } from '@prisma/client';
import { OrganizationReviewsService, reconcileInactiveOwnerReviews } from '../../src/modules/organizations/organization-reviews.service';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
const reviews = new OrganizationReviewsService(prisma as PrismaService);
async function fixture() {
  const organization = await prisma.organization.create({ data: { name: 'Family' } });
  const owner = await prisma.user.create({ data: { email: 'owner@test.local', name: 'Owner' } });
  const admin = await prisma.user.create({ data: { email: 'admin@test.local', name: 'Admin', platformRole: 'ADMIN' } });
  const successor = await prisma.user.create({ data: { email: 'member@test.local', name: 'Member' } });
  await prisma.organizationMembership.createMany({ data: [{ userId: owner.id, organizationId: organization.id, role: 'OWNER' }, { userId: successor.id, organizationId: organization.id, role: 'MEMBER' }] });
  return { organization, owner, admin, successor, actor: { userId: owner.id, email: owner.email, platformRole: PlatformRole.NONE }, adminActor: { userId: admin.id, email: admin.email, platformRole: PlatformRole.ADMIN } };
}
function barrier() {
  let release!: () => void;
  return { wait: new Promise<void>((resolve) => { release = resolve; }), release: () => release() };
}

describe('organization administrator reviews', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it('only ADMIN may close; closure preserves the event while revoking its customer roles', async () => {
    const { organization, owner, actor, adminActor } = await fixture();
    const event = await prisma.event.create({ data: { organizationId: organization.id, title: 'Family', type: 'WEDDING', hostsLabel: 'Family', startsAt: new Date() } });
    await prisma.eventMembership.create({ data: { eventId: event.id, userId: owner.id, role: 'OWNER' } });
    const review = await reviews.request(organization.id, actor, { expectedRevision: 0 });
    await expect(reviews.resolve(actor, review.reviewId, { decision: 'CLOSE', expectedRevision: 0 })).rejects.toThrow('administrator');
    await reviews.resolve(adminActor, review.reviewId, { decision: 'CLOSE', expectedRevision: 0 });
    expect(await prisma.event.findUnique({ where: { id: event.id } })).not.toBeNull();
    expect(await prisma.eventMembership.count()).toBe(0);
    expect(await prisma.organizationMembership.count()).toBe(0);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } })).deletedAt).not.toBeNull();
  });
  it('creates a recovery review after an owner becomes inactive', async () => {
    const { organization, owner } = await fixture();
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });
    await reconcileInactiveOwnerReviews(prisma as PrismaService, owner.id);
    expect(await prisma.organizationAccessReview.findUnique({ where: { organizationId: organization.id } })).toMatchObject({ status: 'OPEN', reason: 'INACTIVE_OWNER_RECOVERY' });
  });
  it('rechecks active owners under the org fence after a concurrent authorized promotion', async () => {
    const { organization, owner, successor, adminActor } = await fixture();
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });
    const entered = barrier(); const proceed = barrier();
    const database = { organizationMembership: prisma.organizationMembership,
      $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => prisma.$transaction(async (tx) => {
        const raw = tx.$queryRaw.bind(tx);
        return callback(new Proxy(tx, { get(target, property) {
          if (property !== '$queryRaw') return Reflect.get(target, property) as unknown;
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (strings.join('').includes('SELECT id FROM organizations')) { entered.release(); await proceed.wait; }
            return raw(strings, ...values);
          };
        } }));
      }) };
    const reconciliation = reconcileInactiveOwnerReviews(database as unknown as PrismaService, owner.id);
    await entered.wait;
    await new OrganizationsService(prisma as PrismaService).changeMember(organization.id, adminActor, { userId: successor.id, role: 'OWNER', expectedRevision: 0 });
    proceed.release();
    await reconciliation;
    expect(await prisma.organizationAccessReview.count()).toBe(0);
  });
});
