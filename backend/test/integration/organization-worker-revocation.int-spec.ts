import { PlatformRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { OrganizationReviewsService } from '../../src/modules/organizations/organization-reviews.service';
import { ExportSnapshotsService } from '../../src/modules/exports/export-snapshots.service';
import { ExportRunner } from '../../src/modules/exports/export-runner';
import { ExportQueue } from '../../src/modules/exports/export-queue';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { PrivateStorage, PrivateStorageService } from '../../src/infra/storage/private/private-storage';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { seatingTestJob } from '../fixtures/seating-job.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
const database = prisma as PrismaService;
const organizations = new OrganizationsService(database);
async function fixture(platformRole: PlatformRole) {
  const event = await seedEvent(prisma);
  await prisma.table.create({ data: { eventId: event.eventId, name: 'Family', capacity: 4 } });
  await prisma.rsvp.updateMany({ where: { guest: { eventId: event.eventId } }, data: { status: 'ATTENDING' } });
  const worker = await seatingTestJob(prisma, event.eventId);
  const user = await prisma.user.update({ where: { email: `seating-${event.eventId}@test.local` }, data: { platformRole } });
  const organization = await prisma.organization.findFirstOrThrow({ where: { events: { some: { id: event.eventId } } } });
  const owner = await prisma.user.create({ data: { name: 'Owner', email: 'owner@test.local' } });
  await prisma.organizationMembership.createMany({ data: [{ organizationId: organization.id, userId: owner.id, role: 'OWNER' }, { organizationId: organization.id, userId: user.id, role: 'MEMBER' }] });
  const actor = { userId: owner.id, email: owner.email, platformRole: PlatformRole.NONE };
  const remove = () => organizations.removeMember(organization.id, actor, { userId: user.id, expectedRevision: 0 });
  return { ...event, worker, user, organization, actor, remove };
}
function memoryStorage(afterPut: () => Promise<unknown>) {
  const blobs = new Map<string, Buffer>();
  const adapter: PrivateStorage = {
    put: async (key, buffer) => { blobs.set(key, buffer); await afterPut(); },
    get: (key) => Promise.resolve(blobs.get(key)!),
    remove: (key) => { blobs.delete(key); return Promise.resolve(); },
    probe: () => Promise.resolve(),
  };
  return { blobs, storage: new PrivateStorageService(adapter) };
}

describe('organization departure worker authority', () => {
  beforeEach(resetTestDatabase);
  afterEach(() => jest.restoreAllMocks());
  afterAll(disconnectTestDatabase);
  it.each([PlatformRole.NONE, PlatformRole.SUPPORT, PlatformRole.ADMIN])('seating rechecks %s authority after departure during computation', async (role) => {
    const event = await fixture(role);
    const plan = event.worker.planner.plan.bind(event.worker.planner);
    jest.spyOn(event.worker.planner, 'plan').mockImplementationOnce(async (input) => { const result = await plan(input); await event.remove(); return result; });
    await event.worker.runner.runOne();
    const job = await prisma.seatingJob.findUniqueOrThrow({ where: { id: event.worker.job.id } });
    const canContinueAsStaff = role !== PlatformRole.NONE;
    expect(job.status).toBe(canContinueAsStaff ? 'COMPLETED' : 'FAILED');
    expect(await prisma.seat.count({ where: { eventId: event.eventId } })).toBe(canContinueAsStaff ? 1 : 0);
    expect(await prisma.eventMembership.count({ where: { userId: event.user.id, eventId: event.eventId } })).toBe(0);
    expect(await prisma.organizationMembership.count({ where: { userId: event.user.id } })).toBe(0);
  });
  it.each([PlatformRole.NONE, PlatformRole.SUPPORT, PlatformRole.ADMIN])('export rechecks %s authority after departure during storage upload', async (role) => {
    const event = await fixture(role);
    const { blobs, storage } = memoryStorage(event.remove);
    const exports = new ExportSnapshotsService(database, storage);
    const queue = new ExportQueue(database);
    const runner = new ExportRunner(database, queue, storage, new OperationsService(database, {} as AnalyticsService));
    const job = await exports.create(event.eventId, event.user.id, { kind: 'GUEST_LIST', format: 'CSV', locale: 'en', idempotencyKey: randomUUID() });
    await runner.runOne();
    const result = await prisma.exportSnapshot.findUniqueOrThrow({ where: { id: job.id } });
    const canContinueAsStaff = role !== PlatformRole.NONE;
    expect(result.status).toBe(canContinueAsStaff ? 'COMPLETED' : 'FAILED');
    await runner.cleanup();
    expect(blobs.size).toBe(canContinueAsStaff ? 1 : 0);
    const hasDownloadBytes = await exports.download(event.eventId, job.id, event.user.id).then((result) => result.buffer.length > 0, () => false);
    expect(hasDownloadBytes).toBe(canContinueAsStaff);
  });
  it('reviewed closure cancels every tenant job even for independently authorized ADMIN staff', async () => {
    const event = await fixture(PlatformRole.ADMIN);
    const reviews = new OrganizationReviewsService(database);
    const review = await reviews.request(event.organization.id, event.actor, { expectedRevision: 0 });
    await reviews.resolve({ userId: event.user.id, email: event.user.email, platformRole: PlatformRole.ADMIN }, review.reviewId, { decision: 'CLOSE', expectedRevision: 0 });
    expect((await prisma.seatingJob.findUniqueOrThrow({ where: { id: event.worker.job.id } })).status).toBe('FAILED');
  });
});
