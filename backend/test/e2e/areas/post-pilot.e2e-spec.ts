import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * docs/API.md, "Staff enquiries and consultation appointments": the HTTP side
 * of intake — gates, bounded queue paging, command status codes and the
 * conversion route's 201/200 contract.
 */
const INTAKE_ENV = ['SALES_INTAKE_ENABLED', 'SALES_INTAKE_SUPPORT_ENABLED', 'SALES_ENQUIRY_CONVERSION_ENABLED', 'SALES_INTENT_HMAC_KEY_ID', 'SALES_INTENT_HMAC_KEYS', 'SALES_PRIVACY_JOURNAL_DIR', 'SALES_PRIVACY_JOURNAL_KEY'];
const NEW_EVENT = { type: 'WEDDING', title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z' };

describe('staff intake HTTP contract (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let config: ConfigService;
  let directory: string;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'post-pilot-e2e-journal-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
    Object.assign(process.env, { SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_ENQUIRY_CONVERSION_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test',
      SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }), SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32) });
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    config = app.get(ConfigService);
  });
  beforeEach(resetTestDatabase);
  afterAll(async () => {
    if (app) await app.close();
    await disconnectTestDatabase();
    await rm(directory, { recursive: true, force: true });
    for (const key of INTAKE_ENV) delete process.env[key];
  });

  async function operator(role: 'ADMIN' | 'SUPPORT' | 'NONE') {
    const actor = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: actor.userId }, data: { platformRole: role } });
    return actor;
  }
  async function createCase(authorization: string, contact: Record<string, string> = { name: 'Anna', email: 'anna@example.am' }) {
    const created = await http().post('/api/v1/sales/enquiries').set('Authorization', authorization).set('Idempotency-Key', `create-${randomUUID()}`).send({ contact }).expect(201);
    return created.body.enquiry.id as string;
  }
  async function withFlag<T>(key: string, value: string, body: () => Promise<T>): Promise<T> {
    const previous = config.get<string>(key)!;
    config.set(key, value);
    try { return await body(); } finally { config.set(key, previous); }
  }
  const fields = (body: unknown) => (body as { details: { field: string | null }[] }).details.map((detail) => detail.field);

  describe('gates', () => {
    it('refuses SUPPORT every intake route while the support flag is off, and still serves ADMIN', async () => {
      const [support, admin] = await Promise.all([operator('SUPPORT'), operator('ADMIN')]);
      const id = await createCase(support.authorization);
      await withFlag('SALES_INTAKE_SUPPORT_ENABLED', 'false', async () => {
        const refused = await http().get('/api/v1/sales/enquiries').set('Authorization', support.authorization).expect(403);
        expect(refused.body.message).toBe('Staff intake support is not enabled');
        await http().get(`/api/v1/sales/enquiries/${id}`).set('Authorization', support.authorization).expect(403);
        await http().post('/api/v1/sales/enquiries').set('Authorization', support.authorization).set('Idempotency-Key', 'support-off-create').send({ contact: { name: 'Bob', phone: '+37499000111' } }).expect(403);
        await http().post(`/api/v1/sales/enquiries/${id}/notes`).set('Authorization', support.authorization).set('Idempotency-Key', 'support-off-note').send({ expectedRevision: 1, body: 'Blocked' }).expect(403);
        const queue = await http().get('/api/v1/sales/enquiries').set('Authorization', admin.authorization).expect(200);
        expect((queue.body.items as { id: string }[]).map((item) => item.id)).toEqual([id]);
      });
      expect(await prisma.salesEnquiry.count()).toBe(1);
      expect(await prisma.enquiryNote.count()).toBe(0);
    });

    it('answers 404 on the conversion route while conversion is off, even with intake on', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization);
      await withFlag('SALES_ENQUIRY_CONVERSION_ENABLED', 'false', () => http().post(`/api/v1/sales/enquiries/${id}/conversion`).set('Authorization', support.authorization)
        .set('Idempotency-Key', 'conversion-off-key').send({ expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'anna@example.am' } } }).expect(404));
      expect(await prisma.organization.count()).toBe(0);
    });
  });

  describe('queue paging', () => {
    it.each(['0', '101', 'abc'])('refuses limit=%s naming the limit field', async (limit) => {
      const admin = await operator('ADMIN');
      const response = await http().get(`/api/v1/sales/enquiries?limit=${limit}`).set('Authorization', admin.authorization).expect(400);
      expect(fields(response.body)).toContain('limit');
    });

    it.each(['1', '100'])('accepts limit=%s', async (limit) => {
      const admin = await operator('ADMIN');
      await createCase(admin.authorization);
      const response = await http().get(`/api/v1/sales/enquiries?limit=${limit}`).set('Authorization', admin.authorization).expect(200);
      expect(response.body).toEqual({ items: [expect.objectContaining({ stage: 'NEW' })], nextCursor: null });
      expect(response.headers['cache-control']).toBe('private, no-store');
    });

    it('pages with nextCursor and refuses it with different search filters', async () => {
      const admin = await operator('ADMIN');
      await createCase(admin.authorization, { name: 'Anna', email: 'anna@example.am' });
      await createCase(admin.authorization, { name: 'Annabel', email: 'annabel@example.am' });
      const first = await http().get('/api/v1/sales/enquiries?limit=1&search=ann').set('Authorization', admin.authorization).expect(200);
      const cursor = encodeURIComponent(first.body.nextCursor as string);
      const second = await http().get(`/api/v1/sales/enquiries?limit=1&search=ann&cursor=${cursor}`).set('Authorization', admin.authorization).expect(200);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
      expect(second.body.nextCursor).toBeNull();
      const reused = await http().get(`/api/v1/sales/enquiries?limit=1&search=bob&cursor=${cursor}`).set('Authorization', admin.authorization).expect(400);
      expect(reused.body.message).toBe('cursor is invalid for these filters');
    });
  });

  describe('command status codes', () => {
    it('refuses SUPPORT assignment with 403 and answers ADMIN same-assignee with 409 NO_CHANGE', async () => {
      const [support, other, admin] = await Promise.all([operator('SUPPORT'), operator('SUPPORT'), operator('ADMIN')]);
      const id = await createCase(support.authorization);
      await http().post(`/api/v1/sales/enquiries/${id}/assignment`).set('Authorization', support.authorization).set('Idempotency-Key', 'support-assign-key').send({ expectedRevision: 1, assignedUserId: other.userId }).expect(403);
      const same = await http().post(`/api/v1/sales/enquiries/${id}/assignment`).set('Authorization', admin.authorization).set('Idempotency-Key', 'same-assign-key').send({ expectedRevision: 1, assignedUserId: support.userId }).expect(409);
      expect(same.body).toMatchObject({ code: 'NO_CHANGE', action: 'EDIT' });
      expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id } })).revision).toBe(1);
    });

    it('answers a reused note key with a different body with 409 IDEMPOTENCY_CONFLICT', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization);
      await http().post(`/api/v1/sales/enquiries/${id}/notes`).set('Authorization', support.authorization).set('Idempotency-Key', 'note-command-key').send({ expectedRevision: 1, body: 'A' }).expect(200);
      const conflict = await http().post(`/api/v1/sales/enquiries/${id}/notes`).set('Authorization', support.authorization).set('Idempotency-Key', 'note-command-key').send({ expectedRevision: 1, body: 'B' }).expect(409);
      expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', action: 'RELOAD' });
      expect(await prisma.enquiryNote.count()).toBe(1);
    });

    it('moves stage with 200 and answers the same stage with 409 NO_CHANGE', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization);
      const moved = await http().post(`/api/v1/sales/enquiries/${id}/stage`).set('Authorization', support.authorization).set('Idempotency-Key', 'stage-move-key').send({ expectedRevision: 1, stage: 'READY_FOR_QUOTE' }).expect(200);
      expect(moved.body).toMatchObject({ appliedRevision: 2, enquiry: { stage: 'READY_FOR_QUOTE' } });
      const same = await http().post(`/api/v1/sales/enquiries/${id}/stage`).set('Authorization', support.authorization).set('Idempotency-Key', 'stage-same-key').send({ expectedRevision: 2, stage: 'READY_FOR_QUOTE' }).expect(409);
      expect(same.body.code).toBe('NO_CHANGE');
    });
  });

  describe('consultation routes', () => {
    const slot = { startsAt: '2026-11-02T10:00:00Z', endsAt: '2026-11-02T11:00:00Z', timezone: 'Asia/Yerevan' };
    it('schedules with 201, updates with 200 and refuses a terminal appointment with 400', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization);
      const created = await http().post(`/api/v1/sales/enquiries/${id}/consultations`).set('Authorization', support.authorization).set('Idempotency-Key', 'schedule-route-key')
        .send({ expectedRevision: 1, operatorUserId: support.userId, ...slot }).expect(201);
      const consultationId = created.body.resultId as string;
      const path = `/api/v1/sales/enquiries/${id}/consultations/${consultationId}`;
      await http().patch(path).set('Authorization', support.authorization).set('Idempotency-Key', 'complete-route-key').send({ expectedRevision: 2, expectedConsultationRevision: 1, status: 'COMPLETED' }).expect(200);
      const terminal = await http().patch(path).set('Authorization', support.authorization).set('Idempotency-Key', 'after-terminal-key').send({ expectedRevision: 3, expectedConsultationRevision: 2, status: 'CANCELLED' }).expect(400);
      expect(terminal.body.message).toBe('status is terminal; create a new consultation');
      expect(await prisma.consultation.findUniqueOrThrow({ where: { id: consultationId } })).toMatchObject({ status: 'COMPLETED', cancelledAt: null });
      const missing = await http().patch(path).set('Authorization', support.authorization).set('Idempotency-Key', 'missing-revision-key').send({ expectedRevision: 3, status: 'CANCELLED' }).expect(400);
      expect(fields(missing.body)).toContain('expectedConsultationRevision');
      await http().patch(`/api/v1/sales/enquiries/${id}/consultations/unknown-consultation`).set('Authorization', support.authorization).set('Idempotency-Key', 'unknown-route-key').send({ expectedRevision: 3, expectedConsultationRevision: 1 }).expect(404);
    });

    it('serves availability without enquiry identity and refuses a window over 31 days naming the to field', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization);
      await http().post(`/api/v1/sales/enquiries/${id}/consultations`).set('Authorization', support.authorization).set('Idempotency-Key', 'availability-slot-key').send({ expectedRevision: 1, operatorUserId: support.userId, ...slot }).expect(201);
      const query = (from: string, to: string) => `/api/v1/sales/consultation-availability?operatorUserId=${support.userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const busy = await http().get(query('2026-11-01T00:00:00Z', '2026-12-02T00:00:00Z')).set('Authorization', support.authorization).expect(200);
      expect(busy.body).toEqual({ operatorUserId: support.userId, busy: [{ startsAt: '2026-11-02T10:00:00.000Z', endsAt: '2026-11-02T11:00:00.000Z' }] });
      const tooLong = await http().get(query('2026-11-01T00:00:00Z', '2026-12-02T00:00:01Z')).set('Authorization', support.authorization).expect(400);
      expect(fields(tooLong.body)).toContain('to');
    });
  });

  describe('conversion route', () => {
    beforeEach(async () => {
      await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', subject: { en: '{{organizationName}}' }, body: { en: '{{link}}' } } });
    });
    const convert = (authorization: string, id: string, key: string) => http().post(`/api/v1/sales/enquiries/${id}/conversion`).set('Authorization', authorization).set('Idempotency-Key', key);

    it('answers first setup with 201 and private no-store, and the same-key replay with 200', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization);
      const dto = { expectedRevision: 1, organization: { create: { name: 'Anna family', ownerEmail: 'anna@example.am', ownerEmailSource: 'PRIMARY_CONTACT' } }, event: { create: NEW_EVENT } };
      const first = await convert(support.authorization, id, 'http-full-conversion').send(dto).expect(201);
      expect(first.headers['cache-control']).toBe('private, no-store');
      expect(first.body).toMatchObject({ appliedRevision: 2, conversion: { organizationId: expect.any(String), eventId: expect.any(String) } });
      const replay = await convert(support.authorization, id, 'http-full-conversion').send(dto).expect(200);
      expect(replay.body.commandId).toBe(first.body.commandId);
      expect(replay.body.conversion).toEqual(first.body.conversion);
      expect(await prisma.event.count()).toBe(1);
      expect(await prisma.message.count()).toBe(1);
    });

    it('answers organization-only setup with 201 and the later add-event with 200', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization, { name: 'Lilit', email: 'lilit@example.am' });
      const linked = await convert(support.authorization, id, 'http-org-only').send({ expectedRevision: 1, organization: { create: { name: 'Lilit family', ownerEmail: 'lilit@example.am' } } }).expect(201);
      expect(linked.body.conversion.eventId).toBeNull();
      const organizationId = linked.body.conversion.organizationId as string;
      const added = await convert(support.authorization, id, 'http-add-event').send({ expectedRevision: 2, organization: { existingId: organizationId }, event: { create: NEW_EVENT } }).expect(200);
      expect(added.body.conversion).toMatchObject({ organizationId, eventId: expect.any(String) });
      expect((await prisma.event.findUniqueOrThrow({ where: { id: added.body.conversion.eventId as string } })).status).toBe('DRAFT');
      expect(await prisma.message.count()).toBe(1);
    });

    it('refuses a missing Idempotency-Key with 400 naming the header', async () => {
      const support = await operator('SUPPORT');
      const id = await createCase(support.authorization);
      const response = await http().post(`/api/v1/sales/enquiries/${id}/conversion`).set('Authorization', support.authorization)
        .send({ expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'anna@example.am' } } }).expect(400);
      expect(fields(response.body)).toEqual(['Idempotency-Key']);
      expect(await prisma.organization.count()).toBe(0);
    });

    it('refuses a customer with 403 and a malformed owner email with 400 naming it', async () => {
      const [support, customer] = await Promise.all([operator('SUPPORT'), operator('NONE')]);
      const id = await createCase(support.authorization);
      await convert(customer.authorization, id, 'customer-conversion').send({ expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'anna@example.am' } } }).expect(403);
      const invalid = await convert(support.authorization, id, 'bad-email-conversion').send({ expectedRevision: 1, organization: { create: { name: 'Family', ownerEmail: 'not-an-email' } } }).expect(400);
      expect(fields(invalid.body).some((field) => field?.endsWith('ownerEmail'))).toBe(true);
    });
  });
});
