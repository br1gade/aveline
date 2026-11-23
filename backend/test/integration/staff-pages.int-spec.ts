import { DataSubjectRequestStatus, PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { findOrganizationsPage } from '../../src/modules/organizations/concierge-pages';
import { FindOrganizationsPageQuery } from '../../src/modules/organizations/dto/concierge.dto';
import { InvoicePagesService } from '../../src/modules/billing/invoice-pages.service';
import { PrivacyPagesService } from '../../src/modules/privacy/privacy-pages.service';
import { PrivacyQueue } from '../../src/modules/privacy/dto/privacy-pages.dto';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const DATE = new Date('2027-01-01T00:00:00.000Z');
const organizationQuery = (cursor?: string): FindOrganizationsPageQuery => ({ limit: 20, search: 'family', cursor });

async function collectPages<T>(read: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 8; page += 1) {
    const result = await read(cursor);
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  throw new Error('The test list did not finish within eight pages');
}

describe('staff and invoice cursor pages', () => {
  let prisma: PrismaClient;
  let privacy: PrivacyPagesService;
  let invoices: InvoicePagesService;
  beforeAll(() => {
    prisma = testPrisma();
    privacy = new PrivacyPagesService(prisma as PrismaService);
    invoices = new InvoicePagesService(prisma as PrismaService);
  });
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  it('reaches organizations beyond fifty with tied dates and excludes closed or unmatched organizations', async () => {
    const organizations = Array.from({ length: 53 }, (_, index) => ({ id: `org-${String(index).padStart(3, '0')}`, name: 'Family', createdAt: DATE }));
    await prisma.organization.createMany({ data: [...organizations,
      { id: 'closed', name: 'Family', createdAt: DATE, deletedAt: DATE }, { id: 'unmatched', name: 'Other', createdAt: DATE }] });
    const rows = await collectPages((cursor) => findOrganizationsPage(prisma as PrismaService, organizationQuery(cursor)));
    expect(rows.map((row) => row.id)).toEqual(organizations.map((row) => row.id).reverse());
  });

  it('continues after a deleted boundary and leaves newer insertions for a refreshed list', async () => {
    await prisma.organization.createMany({ data: ['org-a', 'org-b', 'org-c'].map((id) => ({ id, name: 'Family', createdAt: DATE })) });
    const first = await findOrganizationsPage(prisma as PrismaService, { ...organizationQuery(), limit: 1 });
    await prisma.organization.delete({ where: { id: first.items[0].id } });
    await prisma.organization.create({ data: { id: 'newer', name: 'Family', createdAt: new Date('2027-02-01T00:00:00.000Z') } });
    const next = await findOrganizationsPage(prisma as PrismaService, { ...organizationQuery(first.nextCursor!), limit: 2 });
    expect(next.items.map((row) => row.id)).toEqual(['org-b', 'org-a']);
    await expect(findOrganizationsPage(prisma as PrismaService, { ...organizationQuery(first.nextCursor!), search: 'different' }))
      .rejects.toThrow('cursor: invalid for these filters');
  });

  it('keeps current owners and only live pending owner invitations in customer rows', async () => {
    const organization = await prisma.organization.create({ data: { name: 'Family' } });
    const owner = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner' } });
    await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: owner.id, role: 'OWNER' } });
    await prisma.organizationInvite.createMany({ data: [
      { organizationId: organization.id, email: 'live@example.test', role: 'OWNER', tokenHash: 'live', expiresAt: new Date('2099-01-01T00:00:00.000Z') },
      { organizationId: organization.id, email: 'old@example.test', role: 'OWNER', tokenHash: 'old', expiresAt: DATE, revokedAt: DATE },
    ] });
    const result = await findOrganizationsPage(prisma as PrismaService, organizationQuery());
    expect(result.items[0]).toMatchObject({ owners: ['owner@example.test'], pendingOwnerInvites: ['live@example.test'] });
  });

  it('reaches more than two hundred open requests in deadline order across all open statuses', async () => {
    const statuses: DataSubjectRequestStatus[] = ['IN_PROGRESS', 'VERIFYING', 'RECEIVED'];
    const requests = Array.from({ length: 205 }, (_, index) => ({ id: `request-${String(index).padStart(3, '0')}`,
      kind: 'EXPORT' as const, status: statuses[index % statuses.length], subjectEmail: 'subject@example.test', dueAt: new Date(DATE.getTime() + index * 1000) }));
    await prisma.dataSubjectRequest.createMany({ data: requests });
    const rows = await collectPages((cursor) => privacy.page({ queue: PrivacyQueue.OPEN, limit: 50, cursor }));
    expect(rows.map((row) => row.id)).toEqual(requests.map((row) => row.id));
  });

  it('pages closed requests through the null-date legacy group without inventing dates', async () => {
    await prisma.dataSubjectRequest.createMany({ data: [
      { id: 'dated', kind: 'EXPORT', subjectEmail: 'subject@example.test', status: 'COMPLETED', dueAt: DATE, completedAt: DATE },
      { id: 'legacy-a', kind: 'EXPORT', subjectEmail: 'subject@example.test', status: 'COMPLETED', dueAt: DATE },
      { id: 'legacy-b', kind: 'ERASURE', subjectEmail: 'subject@example.test', status: 'REJECTED', dueAt: DATE },
    ] });
    const first = await privacy.page({ queue: PrivacyQueue.CLOSED, limit: 1 });
    await prisma.dataSubjectRequest.update({ where: { id: 'legacy-b' }, data: { notes: 'Notes do not reorder the queue' } });
    const next = await privacy.page({ queue: PrivacyQueue.CLOSED, limit: 1, cursor: first.nextCursor! });
    const last = await privacy.page({ queue: PrivacyQueue.CLOSED, limit: 1, cursor: next.nextCursor! });
    expect([first.items[0].id, next.items[0].id, last.items[0].id]).toEqual(['dated', 'legacy-b', 'legacy-a']);
    expect(last.items[0].completedAt).toBeNull();
    expect(last.nextCursor).toBeNull();
  });

  it('refuses an incompatible status and a cursor from another privacy queue', async () => {
    await expect(privacy.page({ queue: PrivacyQueue.OPEN, status: 'COMPLETED', limit: 50 })).rejects.toThrow('status:');
    await prisma.dataSubjectRequest.createMany({ data: ['a', 'b'].map((id) => ({ id, kind: 'EXPORT', subjectEmail: 'subject@example.test', dueAt: DATE })) });
    const first = await privacy.page({ queue: PrivacyQueue.OPEN, limit: 1 });
    await expect(privacy.page({ queue: PrivacyQueue.CLOSED, limit: 1, cursor: first.nextCursor! })).rejects.toThrow('cursor:');
  });

  it('reaches invoices beyond one hundred and binds continuation to the selected organization', async () => {
    const first = await prisma.organization.create({ data: { name: 'First' } });
    const other = await prisma.organization.create({ data: { name: 'Other' } });
    const values = Array.from({ length: 105 }, (_, index) => ({ id: `invoice-${String(index).padStart(3, '0')}`, number: `TEST-${index}`,
      organizationId: first.id, subtotalMinor: 100n, totalMinor: 100n, createdAt: DATE }));
    await prisma.invoice.createMany({ data: [...values, { id: 'other-invoice', number: 'OTHER', organizationId: other.id, subtotalMinor: 200n, totalMinor: 200n, createdAt: DATE }] });
    const rows = await collectPages((cursor) => invoices.page(first.id, { limit: 50, cursor }, 'en'));
    expect(rows.map((row) => row.number)).toEqual(values.map((row) => row.number).reverse());
    const page = await invoices.page(first.id, { limit: 1 }, 'en');
    await expect(invoices.page(other.id, { limit: 1, cursor: page.nextCursor! }, 'en')).rejects.toThrow('cursor:');
    expect(rows[0].totalMinor).toBe('100');
  });
});
