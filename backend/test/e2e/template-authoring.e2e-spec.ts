import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TemplateGatesService } from '../../src/modules/design/templates/template-gates.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
const definition = { name: 'Authored', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
describe('template authoring HTTP contract', () => {
  let app: INestApplication; let prisma: PrismaClient;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(TemplateGatesService).useValue(new TemplateGatesService(new ConfigService({ TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true' }))).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter()); await app.init();
  });
  beforeEach(() => resetTestDatabase()); afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  const actor = async (platformRole: 'ADMIN' | 'SUPPORT' | 'NONE') => {
    const auth = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: auth.userId }, data: { platformRole } });
    return auth;
  };
  it('rejects customer authoring and unknown nested fields with safe field-level errors', async () => {
    const customer = await actor('NONE'); const admin = await actor('ADMIN');
    await http().post('/api/v1/design-templates').set('Authorization', customer.authorization).send({ key: 'new', definition }).expect(403);
    const response = await http().post('/api/v1/design-templates').set('Authorization', admin.authorization).set('Accept-Language', 'fr').send({ key: 'new', definition: { ...definition, html: '<script/>' } }).expect(400);
    expect(response.body).toMatchObject({ code: 'TEMPLATE_VALIDATION_FAILED', locale: 'fr', details: expect.arrayContaining([expect.objectContaining({ field: 'html' })]) });
  });
  it('returns inert private fixtures and never enables publication through the server flag alone', async () => {
    const admin = await actor('ADMIN');
    const created = await http().post('/api/v1/design-templates').set('Authorization', admin.authorization).send({ key: 'new', definition }).expect(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    const templateId = created.body.templateId as string; const draftId = created.body.draft.id as string;
    const preview = await http().post(`/api/v1/design-templates/${templateId}/drafts/${draftId}/preview`).set('Authorization', admin.authorization).expect(201);
    expect(preview.body).toMatchObject({ canPublish: false, rendererAcceptance: 'PAYLOAD_ONLY', payloads: { fr: { isAcceptingResponses: false, guest: null } } });
    const response = await http().post(`/api/v1/design-templates/${templateId}/drafts/${draftId}/publish`).set('Authorization', admin.authorization)
      .send({ expectedRevision: 1, previewId: preview.body.previewId, contentHash: preview.body.contentHash, idempotencyKey: randomUUID() }).expect(503);
    expect(response.body.code).toBe('TEMPLATE_CAPABILITY_NOT_DEPLOYED');
  });
  it('keeps the event catalogue scoped to shared plus its own private versions', async () => {
    const seeded = await seedEvent(prisma); const auth = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: 'DESIGNER' });
    const organization = await prisma.organization.create({ data: { name: 'Foreign', kind: 'HOST' } });
    await prisma.designTemplate.create({ data: { key: 'foreign-private', name: 'Foreign artwork', organizationId: organization.id, ownerScopeKey: `org:${organization.id}` } });
    const catalogue = await http().get(`/api/v1/events/${seeded.eventId}/design-templates`).set('Authorization', auth.authorization).expect(200);
    expect((catalogue.body as { key: string }[]).map((template) => template.key)).toEqual(['test-template']);
    await http().get(`/api/v1/events/${seeded.eventId}/design-templates/foreign-private/preview`).set('Authorization', auth.authorization).expect(404);
  });
  it('rejects a private author request whose tab selector belongs to another organization', async () => {
    const admin = await actor('ADMIN');
    const first = await prisma.organization.create({ data: { name: 'First', kind: 'HOST' } });
    const second = await prisma.organization.create({ data: { name: 'Second', kind: 'HOST' } });
    const mismatch = await http().post('/api/v1/design-templates').set('Authorization', admin.authorization).set('X-Aveline-Organization-Id', first.id)
      .send({ organizationId: second.id, definition }).expect(409);
    expect(mismatch.body.code).toBe('ORGANIZATION_CONTEXT_MISMATCH');
    expect(await prisma.designTemplate.count()).toBe(0);
    const created = await http().post('/api/v1/design-templates').set('Authorization', admin.authorization).set('X-Aveline-Organization-Id', second.id)
      .send({ organizationId: second.id, definition }).expect(201);
    const detail = await http().get(`/api/v1/design-templates/${created.body.templateId as string}`).set('Authorization', admin.authorization)
      .set('X-Aveline-Organization-Id', first.id).expect(409);
    expect(detail.body.code).toBe('ORGANIZATION_CONTEXT_MISMATCH');
  });

});
