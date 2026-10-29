import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrivateStorageService } from '../../src/infra/storage/private/private-storage';
import { TemplateGatesService } from '../../src/modules/design/templates/template-gates.service';
import { TemplateCapabilitiesService } from '../../src/modules/design/templates/capabilities/template-capabilities.service';
import { TemplateAssetRunner } from '../../src/modules/design/templates/template-asset-runner';
import { TemplateMaterializationRunner } from '../../src/modules/design/templates/template-materialization-runner';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { testTemplateCapabilities } from '../fixtures/template.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
const definition = { name: 'Authored artwork', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
describe('private template artwork HTTP flow', () => {
  let app: INestApplication; let prisma: PrismaClient; let sanitizer: TemplateAssetRunner; let materializer: TemplateMaterializationRunner;
  const objects = new Map<string, Buffer>();
  const storage = { put: (key: string, buffer: Buffer) => { objects.set(key, buffer); return Promise.resolve(); }, get: (key: string) => {
    const buffer = objects.get(key); return buffer ? Promise.resolve(buffer) : Promise.reject(new Error('missing private object'));
  }, remove: (key: string) => { objects.delete(key); return Promise.resolve(); }, probe: () => Promise.resolve() };
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(TemplateGatesService).useValue(new TemplateGatesService(new ConfigService({ TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true', TEMPLATE_ADOPTION_ENABLED: 'true', TEMPLATE_ASSETS_ENABLED: 'true' })))
      .overrideProvider(TemplateCapabilitiesService).useValue(testTemplateCapabilities(['HERO'])).overrideProvider(PrivateStorageService).useValue(storage).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init();
    sanitizer = new TemplateAssetRunner(prisma as unknown as PrismaService, storage as unknown as PrivateStorageService);
    materializer = new TemplateMaterializationRunner(prisma as unknown as PrismaService, storage as unknown as PrivateStorageService);
  });
  beforeEach(async () => { await resetTestDatabase(); objects.clear(); }); afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  it('uploads, publishes, prepares, confirms and serves only authorized current-pin bytes without redirects', async () => {
    const seeded = await seedEvent(prisma, { visibility: 'UNLISTED' }); const auth = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: auth.userId }, data: { platformRole: 'ADMIN' } });
    const created = await http().post('/api/v1/design-templates').set('Authorization', auth.authorization).send({ key: 'http-artwork', definition }).expect(201);
    const templateId = created.body.templateId as string; const draftId = created.body.draft.id as string;
    const buffer = await sharp({ create: { width: 5, height: 7, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const uploaded = await http().post(`/api/v1/design-templates/${templateId}/drafts/${draftId}/assets`).set('Authorization', auth.authorization)
      .field('expectedRevision', '1').field('kind', 'COVER').field('idempotencyKey', randomUUID()).attach('file', buffer, { filename: 'sample.png', contentType: 'image/png' }).expect(202);
    await sanitizer.runOne();
    await http().patch(`/api/v1/design-templates/${templateId}/drafts/${draftId}/artwork`).set('Authorization', auth.authorization).send({ expectedRevision: 2, artwork: [{ slot: 'HERO', assetId: uploaded.body.assetId }] }).expect(200);
    const draftPreview = await http().post(`/api/v1/design-templates/${templateId}/drafts/${draftId}/preview`).set('Authorization', auth.authorization).expect(201);
    const published = await http().post(`/api/v1/design-templates/${templateId}/drafts/${draftId}/publish`).set('Authorization', auth.authorization)
      .send({ expectedRevision: 3, previewId: draftPreview.body.previewId, contentHash: draftPreview.body.contentHash, idempotencyKey: randomUUID() }).expect(201);
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: seeded.slug } });
    const pending = await http().post(`/api/v1/invitations/${seeded.slug}/template-upgrade-preview`).set('Authorization', auth.authorization)
      .send({ targetVersionId: published.body.versionId, expectedDesignRevision: String(invitation.designRevision) }).expect(202);
    await materializer.runOne();
    const ready = await http().get(pending.body.pollUrl as string).set('Authorization', auth.authorization).expect(200);
    const editorPath = ready.body.payloads.en.coverUrl as string;
    const editorFile = await http().get(editorPath).set('Authorization', auth.authorization).expect(200);
    expect(editorFile.headers['cache-control']).toBe('private, no-store'); expect(editorFile.headers.location).toBeUndefined();
    const binding = await prisma.invitationTemplateAsset.findFirstOrThrow({ where: { invitationId: invitation.id } });
    await http().get(`/api/v1/invitations/${seeded.slug}/design-assets/${binding.id}/file`).expect(404);
    await http().post(`/api/v1/invitations/${seeded.slug}/template`).set('Authorization', auth.authorization).send({ templateKey: 'http-artwork', templateVersionId: published.body.versionId,
      previewId: pending.body.previewId, expectedTemplateVersionId: invitation.templateVersionId, expectedDesignRevision: String(invitation.designRevision), idempotencyKey: randomUUID() }).expect(201);
    const page = await http().get(`/api/v1/invitations/${seeded.slug}/g/${seeded.primaryGuestToken}`).expect(200);
    const personal = await http().get(page.body.coverUrl as string).expect(200);
    expect(personal.headers['content-type']).toMatch(/^image\/png/); expect(personal.headers['x-content-type-options']).toBe('nosniff');
    expect(personal.headers['cache-control']).toBe('private, no-store'); expect(personal.headers.location).toBeUndefined();
    await http().get(`/api/v1/invitations/${seeded.slug}/g/foreign-credential/design-assets/${binding.id}/file`).expect(404);
    await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { anonymizedAt: new Date() } });
    await http().get(page.body.coverUrl as string).expect(404);
  });
});
