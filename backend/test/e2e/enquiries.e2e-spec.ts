import { ConfigService } from '@nestjs/config';
import { EnquiryJournal } from '../../src/modules/sales/enquiry-journal';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('staff-only enquiry HTTP contract', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let directory: string;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'intake-e2e-journal-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
    Object.assign(process.env, { SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }), SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32) });
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(resetTestDatabase);
  afterAll(async () => {
    if (app) await app.close();
    await disconnectTestDatabase();
    await rm(directory, { recursive: true, force: true });
    for (const key of ['SALES_INTAKE_ENABLED', 'SALES_INTAKE_SUPPORT_ENABLED', 'SALES_INTENT_HMAC_KEY_ID', 'SALES_INTENT_HMAC_KEYS', 'SALES_PRIVACY_JOURNAL_DIR', 'SALES_PRIVACY_JOURNAL_KEY']) delete process.env[key];
  });
  async function operator(role: 'ADMIN' | 'SUPPORT' | 'NONE') {
    const actor = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: actor.userId }, data: { platformRole: role } });
    return actor;
  }
  it('creates self-assigned support contact and protects every current-assignment section', async () => {
    const [support, other, customer, admin] = await Promise.all([operator('SUPPORT'), operator('SUPPORT'), operator('NONE'), operator('ADMIN')]);
    const created = await http().post('/api/v1/sales/enquiries').set('Authorization', support.authorization).set('Idempotency-Key', 'create-enquiry-key').send({ contact: { name: 'Anna', phone: '+37499123456' } }).expect(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    expect(created.body.enquiry.assignedUserId).toBe(support.userId);
    const id = created.body.enquiry.id as string;
    for (const section of ['', '/notes', '/activities', '/consultations']) {
      await http().get(`/api/v1/sales/enquiries/${id}${section}`).set('Authorization', other.authorization).expect(404);
      await http().get(`/api/v1/sales/enquiries/${id}${section}`).set('Authorization', customer.authorization).expect(403);
    }
    await http().post(`/api/v1/sales/enquiries/${id}/assignment`).set('Authorization', admin.authorization).set('Idempotency-Key', 'reassign-enquiry-key').send({ expectedRevision: 1, assignedUserId: other.userId }).expect(200);
    await http().post('/api/v1/sales/enquiries').set('Authorization', support.authorization).set('Idempotency-Key', 'create-enquiry-key').send({ contact: { name: 'Anna', phone: '+37499123456' } }).expect(404);
    const queue = await http().get('/api/v1/sales/enquiries').set('Authorization', support.authorization).expect(200);
    expect(queue.body.items).toEqual([]);
  });
  it('returns field-named validation errors and forbids support assignment fields', async () => {
    const support = await operator('SUPPORT');
    await http().post('/api/v1/sales/enquiries').set('Authorization', support.authorization).set('Idempotency-Key', 'bad-enquiry-key').send({ contact: { name: 'Anna', phone: '099123456' } }).expect(400).expect((response) => expect(JSON.stringify(response.body)).toContain('phone'));
    await http().post('/api/v1/sales/enquiries').set('Authorization', support.authorization).set('Idempotency-Key', 'bad-assignment-key').send({ contact: { name: 'Anna', phone: '+37499123456' }, assignedUserId: null }).expect(400);
    await http().post('/api/v1/sales/enquiries').send({ contact: { name: 'Anna', phone: '+37499123456' } }).expect(401);
  });
  it('fulfils a manually verified phone-only request without a fabricated address', async () => {
    const admin = await operator('ADMIN');
    const created = await http().post('/api/v1/sales/enquiries').set('Authorization', admin.authorization).set('Idempotency-Key', 'phone-privacy-create').send({ contact: { name: 'Anna', phone: '+37499123456' } }).expect(201);
    const contactId = created.body.enquiry.contact.id as string;
    const privacyRequest = await http().post('/api/v1/privacy/enquiry-requests').set('Authorization', admin.authorization).send({ kind: 'ERASURE', contactIds: [contactId] }).expect(201);
    expect(privacyRequest.body.subjectEmail).toBeNull();
    const requestId = privacyRequest.body.id as string;
    await http().put(`/api/v1/privacy/requests/${requestId}/enquiry-subjects`).set('Authorization', admin.authorization).send({ contactIds: [contactId], verificationNote: 'Reviewed evidence reference 42' }).expect(400);
    await http().patch(`/api/v1/privacy/requests/${requestId}`).set('Authorization', admin.authorization).send({ status: 'IN_PROGRESS' }).expect(200);
    await http().put(`/api/v1/privacy/requests/${requestId}/enquiry-subjects`).set('Authorization', admin.authorization).send({ contactIds: [contactId], verificationNote: 'Reviewed evidence reference 42' }).expect(200);
    const fulfilled = await http().post(`/api/v1/privacy/requests/${requestId}/fulfil`).set('Authorization', admin.authorization).expect(201);
    expect(fulfilled.body.enquiriesCleared).toBe(1);
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('COMPLETED');
    expect((await prisma.enquiryContact.findUniqueOrThrow({ where: { id: contactId } })).phone).toBeNull();
  });
  it('keeps routes closed when the intake gate is disabled', async () => {
    const admin = await operator('ADMIN');
    const config = app.get(ConfigService);
    config.set('SALES_INTAKE_ENABLED', 'false');
    try { await http().get('/api/v1/sales/enquiries').set('Authorization', admin.authorization).expect(404); }
    finally { config.set('SALES_INTAKE_ENABLED', 'true'); }
  });

});
