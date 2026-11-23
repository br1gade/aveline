import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApplication } from '../../src/application';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const DATE = new Date('2027-01-01T00:00:00.000Z');
const PATHS = ['/api/v1/concierge/organizations/page', '/api/v1/privacy/requests/page', '/api/v1/invoices/page'];

describe('paged staff and billing reads over HTTP', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    prisma = testPrisma();
    app = await createApplication();
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });
  beforeEach(resetTestDatabase);
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });

  const staff = async (platformRole: 'ADMIN' | 'SUPPORT') => {
    const account = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: account.userId }, data: { platformRole } });
    return account;
  };
  const owner = async () => {
    const account = await authenticateAs(app, prisma);
    const organization = await prisma.organization.create({ data: {
      name: 'Family', memberships: { create: { userId: account.userId, role: 'OWNER' } },
    } });
    return { ...account, organizationId: organization.id };
  };

  it('requires authentication on all three new page routes', async () => {
    for (const path of PATHS) await http().get(path).expect(401);
  });

  it('allows concierge staff to page customers but reserves privacy and access reviews to ADMIN', async () => {
    const support = await staff('SUPPORT');
    await http().get(PATHS[0]).set('Authorization', support.authorization).expect(200);
    await http().get(PATHS[1]).set('Authorization', support.authorization).expect(403);
    await http().get('/api/v1/admin/organization-access-reviews').set('Authorization', support.authorization).expect(403);
  });

  it('validates page bounds at the HTTP edge and preserves legacy staff arrays', async () => {
    const admin = await staff('ADMIN');
    for (const path of PATHS.slice(0, 2)) {
      for (const limit of [0, 101]) {
        const response = await http().get(path).query({ limit }).set('Authorization', admin.authorization).expect(400);
        expect(JSON.stringify(response.body.message)).toContain('limit');
      }
      await http().get(path).query({ cursor: 'x'.repeat(257) }).set('Authorization', admin.authorization).expect(400);
    }
    const organizations = await http().get('/api/v1/concierge/organizations').set('Authorization', admin.authorization).expect(200);
    const privacy = await http().get('/api/v1/privacy/requests').set('Authorization', admin.authorization).expect(200);
    expect(Array.isArray(organizations.body)).toBe(true);
    expect(Array.isArray(privacy.body)).toBe(true);
  });

  it('uses the open privacy queue by default and rejects a status from the other queue', async () => {
    const admin = await staff('ADMIN');
    await prisma.dataSubjectRequest.createMany({ data: [
      { id: 'open', kind: 'EXPORT', subjectEmail: 'subject@example.test', status: 'VERIFYING', dueAt: DATE },
      { id: 'closed', kind: 'EXPORT', subjectEmail: 'subject@example.test', status: 'COMPLETED', dueAt: DATE, completedAt: DATE },
    ] });
    const open = await http().get(PATHS[1]).set('Authorization', admin.authorization).expect(200);
    const closed = await http().get(PATHS[1]).query({ queue: 'CLOSED' }).set('Authorization', admin.authorization).expect(200);
    expect(open.body.items).toEqual([expect.objectContaining({ id: 'open' })]);
    expect(closed.body.items).toEqual([expect.objectContaining({ id: 'closed' })]);
    const refused = await http().get(PATHS[1]).query({ status: 'COMPLETED' }).set('Authorization', admin.authorization).expect(400);
    expect(JSON.stringify(refused.body.message)).toContain('status');
  });

  it('keeps invoice pages tenant scoped, validates their queries and leaves the legacy history an array', async () => {
    const first = await owner();
    const second = await owner();
    await prisma.invoice.createMany({ data: ['a', 'b'].map((id) => ({ id, number: `TEST-${id}`,
      organizationId: first.organizationId, subtotalMinor: 100n, totalMinor: 100n, createdAt: DATE })) });
    const page = await http().get(PATHS[2]).query({ limit: 1, locale: 'hy' }).set('Authorization', first.authorization).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].totalMinor).toBe('100');
    await http().get(PATHS[2]).query({ cursor: page.body.nextCursor }).set('Authorization', second.authorization).expect(400);
    await http().get(PATHS[2]).set('X-Aveline-Organization-Id', second.organizationId).set('Authorization', first.authorization).expect(403);
    await http().get(PATHS[2]).query({ limit: 101 }).set('Authorization', first.authorization).expect(400);
    const history = await http().get('/api/v1/invoices').set('Authorization', first.authorization).expect(200);
    expect(Array.isArray(history.body)).toBe(true);
    expect(history.body).toHaveLength(2);
  });
});
