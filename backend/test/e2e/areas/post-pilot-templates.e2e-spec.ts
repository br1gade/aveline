import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { TemplateAssetRunner } from '../../../src/modules/design/templates/template-asset-runner';
import { TemplateGatesService } from '../../../src/modules/design/templates/template-gates.service';
import { TEMPLATE_UPLOAD_BYTES } from '../../../src/modules/design/templates/template-raster';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * docs/API.md, "Platform author API": upload limits and types, the template
 * rollout gates, and the organization closure-review routes.
 */
const definition = { name: 'Authored', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
const OPEN_GATES = { TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true', TEMPLATE_ADOPTION_ENABLED: 'true', TEMPLATE_ASSETS_ENABLED: 'true' };

describe('template authoring and organization review HTTP (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sanitizer: TemplateAssetRunner;
  const gateConfig = new ConfigService<Record<string, string>>({ ...OPEN_GATES });
  const objects = new Map<string, Buffer>();
  const storage = { put: (key: string, buffer: Buffer) => { objects.set(key, buffer); return Promise.resolve(); },
    get: (key: string) => { const buffer = objects.get(key); return buffer ? Promise.resolve(buffer) : Promise.reject(new Error('missing private object')); },
    remove: (key: string) => { objects.delete(key); return Promise.resolve(); }, probe: () => Promise.resolve() };
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(TemplateGatesService).useValue(new TemplateGatesService(gateConfig as ConfigService))
      .overrideProvider(PrivateStorageService).useValue(storage).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sanitizer = new TemplateAssetRunner(prisma as unknown as PrismaService, storage as unknown as PrivateStorageService);
  });
  beforeEach(async () => {
    await resetTestDatabase();
    objects.clear();
    for (const [key, value] of Object.entries(OPEN_GATES)) gateConfig.set(key, value);
  });
  afterAll(async () => { if (app) await app.close(); await disconnectTestDatabase(); });

  async function actor(platformRole: 'ADMIN' | 'SUPPORT' | 'NONE') {
    const auth = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: auth.userId }, data: { platformRole } });
    return auth;
  }
  async function authoredDraft(authorization: string) {
    const created = await http().post('/api/v1/design-templates').set('Authorization', authorization).send({ key: `t-${randomUUID().slice(0, 8)}`, definition }).expect(201);
    return { templateId: created.body.templateId as string, draftId: created.body.draft.id as string };
  }
  const upload = (authorization: string, target: { templateId: string; draftId: string }, file: { buffer: Buffer; contentType: string }, kind = 'COVER') =>
    http().post(`/api/v1/design-templates/${target.templateId}/drafts/${target.draftId}/assets`).set('Authorization', authorization)
      .field('expectedRevision', '1').field('kind', kind).field('idempotencyKey', randomUUID()).attach('file', file.buffer, { filename: 'artwork', contentType: file.contentType });
  const png = () => sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const noStagedUpload = async () => {
    expect(await prisma.designTemplateAsset.count()).toBe(0);
    expect(await prisma.designTemplateStoredObject.count()).toBe(0);
    expect(objects.size).toBe(0);
  };

  describe('artwork upload', () => {
    it('refuses a file one byte over the 5MiB limit with 413 and stages nothing', async () => {
      const admin = await actor('ADMIN');
      const target = await authoredDraft(admin.authorization);
      const response = await upload(admin.authorization, target, { buffer: Buffer.alloc(TEMPLATE_UPLOAD_BYTES + 1), contentType: 'image/png' }).expect(413);
      expect(response.body.code).toBe('UPLOAD_TOO_LARGE');
      await noStagedUpload();
    });

    it('refuses a non-raster media type with 415 and stages nothing', async () => {
      const admin = await actor('ADMIN');
      const target = await authoredDraft(admin.authorization);
      const response = await upload(admin.authorization, target, { buffer: Buffer.from('plain words'), contentType: 'text/plain' }).expect(415);
      expect(response.body).toMatchObject({ code: 'TEMPLATE_ASSET_TYPE_UNSUPPORTED', action: 'REUPLOAD' });
      await noStagedUpload();
    });

    it('refuses an unknown kind with 400 naming kind', async () => {
      const admin = await actor('ADMIN');
      const target = await authoredDraft(admin.authorization);
      const response = await upload(admin.authorization, target, { buffer: await png(), contentType: 'image/png' }, 'OTHER').expect(400);
      expect((response.body.details as { field: string | null }[]).map((detail) => detail.field)).toContain('kind');
      await noStagedUpload();
    });

    it('accepts an SVG labelled image/png for processing but the worker fails it and never publishes bytes', async () => {
      const admin = await actor('ADMIN');
      const target = await authoredDraft(admin.authorization);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script></svg>');
      const accepted = await upload(admin.authorization, target, { buffer: svg, contentType: 'image/png' }).expect(202);
      await sanitizer.runOne();
      const asset = await prisma.designTemplateAsset.findUniqueOrThrow({ where: { id: accepted.body.assetId as string } });
      expect(asset).toMatchObject({ state: 'FAILED', errorCode: 'TEMPLATE_ASSET_INVALID' });
      expect(await prisma.designTemplateStoredObject.count({ where: { assetId: asset.id, purpose: { not: 'SOURCE' }, state: 'AVAILABLE' } })).toBe(0);
      expect(objects.has(asset.sanitizedKey ?? '')).toBe(false);
      await http().get(`/api/v1/design-templates/${target.templateId}/assets/${accepted.body.assetId as string}/file`).set('Authorization', admin.authorization).expect(409);
    });
  });

  describe('rollout gates', () => {
    it('refuses template creation with 503 while authoring is off', async () => {
      const admin = await actor('ADMIN');
      gateConfig.set('TEMPLATE_AUTHORING_ENABLED', 'false');
      const response = await http().post('/api/v1/design-templates').set('Authorization', admin.authorization).send({ key: 'gated', definition }).expect(503);
      expect(response.body.code).toBe('TEMPLATE_FEATURE_DISABLED');
      expect(await prisma.designTemplate.count()).toBe(0);
    });

    it('refuses artwork upload with 503 while assets are off', async () => {
      const admin = await actor('ADMIN');
      const target = await authoredDraft(admin.authorization);
      gateConfig.set('TEMPLATE_ASSETS_ENABLED', 'false');
      const response = await upload(admin.authorization, target, { buffer: await png(), contentType: 'image/png' }).expect(503);
      expect(response.body.code).toBe('TEMPLATE_FEATURE_DISABLED');
      await noStagedUpload();
    });

    it('refuses an adoption preview with 503 while adoption is off', async () => {
      const seeded = await seedEvent(prisma);
      const designer = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: 'DESIGNER' });
      const target = await prisma.designTemplate.create({ data: { key: 'gated-target', name: 'Target', supportedBlocks: ['HERO'] } });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: seeded.slug } });
      gateConfig.set('TEMPLATE_ADOPTION_ENABLED', 'false');
      const response = await http().post(`/api/v1/invitations/${seeded.slug}/template-upgrade-preview`).set('Authorization', designer.authorization)
        .send({ targetVersionId: `${target.id}:baseline`, expectedDesignRevision: String(invitation.designRevision) }).expect(503);
      expect(response.body.code).toBe('TEMPLATE_FEATURE_DISABLED');
      expect(await prisma.templatePreview.count()).toBe(0);
    });
  });

  describe('organization closure reviews', () => {
    async function ownedOrganization() {
      const owner = await authenticateAs(app, prisma);
      const organization = await prisma.organization.create({ data: { name: 'Family' } });
      await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: owner.userId, role: 'OWNER' } });
      return { owner, organizationId: organization.id };
    }

    it('lets an OWNER request review over HTTP, keeping access, and an ADMIN list and decline it', async () => {
      const { owner, organizationId } = await ownedOrganization();
      const admin = await actor('ADMIN');
      const requested = await http().post('/api/v1/organizations/current/closure-reviews').set('Authorization', owner.authorization).send({ expectedRevision: 0 }).expect(201);
      expect(requested.body).toMatchObject({ status: 'OPEN', reviewId: expect.any(String) });
      await http().get('/api/v1/organizations/current').set('Authorization', owner.authorization).expect(200);
      const queue = await http().get('/api/v1/admin/organization-access-reviews').set('Authorization', admin.authorization).expect(200);
      expect(queue.body.items).toEqual([expect.objectContaining({ id: requested.body.reviewId, organizationId, status: 'OPEN' })]);
      const resolved = await http().post(`/api/v1/admin/organization-access-reviews/${requested.body.reviewId as string}/resolve`).set('Authorization', admin.authorization)
        .send({ decision: 'DECLINE', expectedRevision: 0 }).expect(201);
      expect(resolved.body).toMatchObject({ status: 'DECLINE', accessRevision: 1 });
      const after = await http().get('/api/v1/admin/organization-access-reviews').set('Authorization', admin.authorization).expect(200);
      expect(after.body.items).toEqual([]);
    });

    it('refuses customers the admin review routes', async () => {
      const { owner } = await ownedOrganization();
      const requested = await http().post('/api/v1/organizations/current/closure-reviews').set('Authorization', owner.authorization).send({ expectedRevision: 0 }).expect(201);
      await http().get('/api/v1/admin/organization-access-reviews').set('Authorization', owner.authorization).expect(403);
      await http().post(`/api/v1/admin/organization-access-reviews/${requested.body.reviewId as string}/resolve`).set('Authorization', owner.authorization).send({ decision: 'CLOSE', expectedRevision: 0 }).expect(403);
      expect((await prisma.organizationAccessReview.findUniqueOrThrow({ where: { id: requested.body.reviewId as string } })).status).toBe('OPEN');
    });

    it('refuses a non-owner member requesting closure review', async () => {
      const { organizationId } = await ownedOrganization();
      const manager = await authenticateAs(app, prisma);
      await prisma.organizationMembership.create({ data: { organizationId, userId: manager.userId, role: 'MANAGER' } });
      await http().post('/api/v1/organizations/current/closure-reviews').set('Authorization', manager.authorization).send({ expectedRevision: 0 }).expect(403);
      expect(await prisma.organizationAccessReview.count()).toBe(0);
    });

    it('refuses an unknown decision with 400 naming decision', async () => {
      const admin = await actor('ADMIN');
      const response = await http().post('/api/v1/admin/organization-access-reviews/some-review/resolve').set('Authorization', admin.authorization).send({ decision: 'MERGE', expectedRevision: 0 }).expect(400);
      expect((response.body.details as { field: string | null }[]).map((detail) => detail.field)).toContain('decision');
    });
  });
});
