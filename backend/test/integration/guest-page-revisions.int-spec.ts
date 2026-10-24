import { PrismaClient } from '@prisma/client';
import { compactGuestPageChanges, readGuestPageMeta } from '../../src/modules/invitations/guest-page-version';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Committed guest-page revisions (integration)', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());
  it('advances when an older transaction commits after a newer transaction', async () => {
    const event = await seedEvent(prisma); const pending = deferred(); const release = deferred();
    const blocks = await prisma.invitationBlock.findMany({ where: { invitation: { eventId: event.eventId } }, orderBy: { sortOrder: 'asc' } });
    const beforeMeta = (await readGuestPageMeta(prisma, event.slug))[0];
    const before = beforeMeta.revision;
    const older = prisma.$transaction(async (tx) => {
      await tx.invitationBlock.update({ where: { id: blocks[0].id }, data: { content: { en: { title: 'Late commit' } } } });
      pending.resolve(); await release.promise;
    }, { timeout: 10000 });
    try {
      await pending.promise;
      await prisma.invitationBlock.update({ where: { id: blocks[1].id }, data: { enabled: false } });
      expect((await readGuestPageMeta(prisma, event.slug))[0].revision).toBe(before + 1n);
      expect((await readGuestPageMeta(prisma, event.slug))[0].sharedRevision).toBe(beforeMeta.sharedRevision! + 1n);
    } finally { release.resolve(); await older; }
    expect((await readGuestPageMeta(prisma, event.slug))[0].revision).toBe(before + 2n);
    expect((await readGuestPageMeta(prisma, event.slug))[0].sharedRevision).toBe(beforeMeta.sharedRevision! + 2n);
  });
  it('coalesces one transaction, rolls back failed changes and preserves revision through compaction', async () => {
    const event = await seedEvent(prisma);
    await prisma.$transaction((tx) => compactGuestPageChanges(tx));
    const beforeMeta = (await readGuestPageMeta(prisma, event.slug, event.primaryGuestToken))[0];
    const before = beforeMeta.revision;
    await prisma.$transaction(async (tx) => {
      await tx.guest.updateMany({ where: { eventId: event.eventId }, data: { firstName: 'Updated' } });
      await tx.household.update({ where: { id: event.householdId }, data: { name: 'Updated household' } });
    });
    await expect(prisma.$transaction(async (tx) => {
      await tx.guest.updateMany({ where: { eventId: event.eventId }, data: { firstName: 'Rolled back' } });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await readGuestPageMeta(prisma, event.slug))[0].revision).toBe(before + 1n);
    const changedMeta = (await readGuestPageMeta(prisma, event.slug, event.primaryGuestToken))[0];
    expect(changedMeta.sharedRevision).toBe(beforeMeta.sharedRevision);
    expect(changedMeta.personalRevision).toBe(beforeMeta.personalRevision! + 1n);
    await prisma.$transaction((tx) => compactGuestPageChanges(tx));
    expect((await readGuestPageMeta(prisma, event.slug))[0].revision).toBe(before + 1n);
    expect(await prisma.guestPageChange.count()).toBe(0);
    const compacted = (await readGuestPageMeta(prisma, event.slug, event.primaryGuestToken))[0];
    expect(compacted.personalRevision).toBe(changedMeta.personalRevision);
    expect(compacted.sharedRevision).toBe(changedMeta.sharedRevision);
    expect(await prisma.guestPayloadChange.count()).toBe(0);
  });
  it('collects orphan metadata without keeping event data alive', async () => {
    const event = await seedEvent(prisma);
    await prisma.event.delete({ where: { id: event.eventId } });
    await prisma.guestPageChange.create({ data: { eventId: event.eventId, transactionId: 1n } });
    expect((await prisma.$transaction((tx) => compactGuestPageChanges(tx))).orphanChangesRemoved).toBeGreaterThan(0);
    expect(await prisma.guestPageChange.count()).toBe(0);
    expect(await prisma.guestPayloadChange.count()).toBe(0);
    expect(await prisma.guestPayloadVersion.count()).toBe(0);
  });
});
