import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { DAY_MS } from '../../fixtures/areas/privacy.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const INTAKE_ENV = ['SALES_INTAKE_ENABLED', 'SALES_INTAKE_SUPPORT_ENABLED', 'SALES_INTENT_HMAC_KEY_ID', 'SALES_INTENT_HMAC_KEYS', 'SALES_PRIVACY_JOURNAL_DIR', 'SALES_PRIVACY_JOURNAL_KEY'];

/**
 * docs/API.md, "Staff enquiry privacy substrate": a staff-recorded,
 * phone-only prospect has subjectEmail null. Their export carries the
 * enquiries and empty legacy sections, rather than querying a fabricated
 * address.
 */
describe('Phone-only privacy requests (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let directory: string;
  // Restored afterwards, so the intake gate does not leak into another suite in this worker.
  const previousEnv = Object.fromEntries(INTAKE_ENV.map((key) => [key, process.env[key]]));
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'privacy-enquiries-e2e-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
    Object.assign(process.env, {
      SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test',
      SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }), SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32),
    });
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    if (app) await app.close();
    await disconnectTestDatabase();
    await rm(directory, { recursive: true, force: true });
    for (const key of INTAKE_ENV) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  const admin = async () => {
    const actor = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: actor.userId }, data: { platformRole: 'ADMIN' } });
    return actor.authorization;
  };

  const phoneOnlyRequest = async (authorization: string, kind: 'EXPORT' | 'ERASURE') => {
    const created = await http().post('/api/v1/sales/enquiries').set('Authorization', authorization).set('Idempotency-Key', `phone-only-${kind}`)
      .send({ contact: { name: 'Anna', phone: '+37499123456' } }).expect(201);
    const contactId = created.body.enquiry.contact.id as string;
    const before = Date.now();
    const filed = await http().post('/api/v1/privacy/enquiry-requests').set('Authorization', authorization).send({ kind, contactIds: [contactId] }).expect(201);
    const after = Date.now();
    return { contactId, requestId: filed.body.id as string, body: filed.body as Record<string, unknown>, before, after };
  };

  it('sets a staff-recorded request’s deadline thirty days from receipt', async () => {
    const authorization = await admin();

    const { body, before, after, requestId } = await phoneOnlyRequest(authorization, 'ERASURE');

    const dueAt = new Date(body.dueAt as string).getTime();
    expect(dueAt).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(dueAt).toBeLessThanOrEqual(after + 30 * DAY_MS);
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } })).dueAt.getTime()).toBe(dueAt);
  });

  it('exports a verified phone-only subject’s enquiry with empty legacy sections, and completes', async () => {
    const authorization = await admin();
    const { contactId, requestId, body } = await phoneOnlyRequest(authorization, 'EXPORT');
    expect(body.subjectEmail).toBeNull();
    await http().patch(`/api/v1/privacy/requests/${requestId}`).set('Authorization', authorization).send({ status: 'IN_PROGRESS' }).expect(200);
    await http().put(`/api/v1/privacy/requests/${requestId}/enquiry-subjects`).set('Authorization', authorization)
      .send({ contactIds: [contactId], verificationNote: 'Reviewed evidence reference 7' }).expect(200);

    const { body: exported } = await http().post(`/api/v1/privacy/requests/${requestId}/fulfil`).set('Authorization', authorization).expect(201);

    expect(exported).toMatchObject({
      kind: 'EXPORT', subjectEmail: null, account: null, templateAuthorship: null,
      guestRecords: [], ticketOrders: [], ticketAttendees: [], messagesSent: [], suppressions: [], contributions: [],
    });
    expect(exported.enquiries).toHaveLength(1);
    expect(JSON.stringify(exported.enquiries)).toContain('+37499123456');
    const stored = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.completedAt).toBeInstanceOf(Date);
  });
});
