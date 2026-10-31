import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { TemplateCapabilitiesService } from '../../../src/modules/design/templates/capabilities/template-capabilities.service';
import { TemplateAssetRunner } from '../../../src/modules/design/templates/template-asset-runner';
import { TemplateGatesService } from '../../../src/modules/design/templates/template-gates.service';
import { TemplateMaterializationRunner } from '../../../src/modules/design/templates/template-materialization-runner';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { testTemplateCapabilities } from '../../fixtures/template.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const definition = { name: 'Private artwork', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'],
  blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };

/**
 * Signed-in reads of private design artwork (docs/API.md, template artwork
 * routes): `GET /events/:eventId/design-assets/:assetId/file` serves an
 * event's own prepared copy to invitation:read on that event, and
 * `GET /events/:eventId/design-templates/:templateKey/assets/:assetId/file`
 * serves a catalogue sample only from a shared or same-organization template.
 * The risk is one organization's artwork read through another's event.
 */
describe('Private design artwork reads (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sanitizer: TemplateAssetRunner;
  let materializer: TemplateMaterializationRunner;
  const objects = new Map<string, Buffer>();
  const storage = {
    put: (key: string, buffer: Buffer) => { objects.set(key, buffer); return Promise.resolve(); },
    get: (key: string) => { const buffer = objects.get(key); return buffer ? Promise.resolve(buffer) : Promise.reject(new Error('missing private object')); },
    remove: (key: string) => { objects.delete(key); return Promise.resolve(); },
    probe: () => Promise.resolve(),
  };
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const gates = new TemplateGatesService(new ConfigService({ TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true', TEMPLATE_ADOPTION_ENABLED: 'true', TEMPLATE_ASSETS_ENABLED: 'true' }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(TemplateGatesService).useValue(gates)
      .overrideProvider(TemplateCapabilitiesService).useValue(testTemplateCapabilities(['HERO']))
      .overrideProvider(PrivateStorageService).useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    sanitizer = new TemplateAssetRunner(prisma as unknown as PrismaService, storage as unknown as PrivateStorageService);
    materializer = new TemplateMaterializationRunner(prisma as unknown as PrismaService, storage as unknown as PrivateStorageService);
  });

  beforeEach(async () => { await resetTestDatabase(); objects.clear(); });
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });

  /**
   * Organization A's private template with one cover, published, and a ready
   * upgrade preview for A's event — so A's event holds a prepared private copy.
   * Organization B is a separate tenant with its own event and owner.
   */
  const twoTenants = async () => {
    const eventA = await seedEvent(prisma, { visibility: 'UNLISTED' });
    const { organizationId } = await prisma.event.findUniqueOrThrow({ where: { id: eventA.eventId } });
    const admin = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: admin.userId }, data: { platformRole: 'ADMIN' } });
    const as = (path: string) => http().post(`/api/v1${path}`).set('Authorization', admin.authorization);

    const created = await as('/design-templates').send({ organizationId, definition }).expect(201);
    const { templateId, key: templateKey } = created.body as { templateId: string; key: string };
    const draftId = created.body.draft.id as string;
    const png = await sharp({ create: { width: 5, height: 7, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const uploaded = await as(`/design-templates/${templateId}/drafts/${draftId}/assets`).field('expectedRevision', '1').field('kind', 'COVER')
      .field('idempotencyKey', randomUUID()).attach('file', png, { filename: 'cover.png', contentType: 'image/png' }).expect(202);
    const templateAssetId = uploaded.body.assetId as string;
    await sanitizer.runOne();
    await http().patch(`/api/v1/design-templates/${templateId}/drafts/${draftId}/artwork`).set('Authorization', admin.authorization)
      .send({ expectedRevision: 2, artwork: [{ slot: 'HERO', assetId: templateAssetId }] }).expect(200);
    const preview = await as(`/design-templates/${templateId}/drafts/${draftId}/preview`).expect(201);
    const published = await as(`/design-templates/${templateId}/drafts/${draftId}/publish`)
      .send({ expectedRevision: 3, previewId: preview.body.previewId, contentHash: preview.body.contentHash, idempotencyKey: randomUUID() }).expect(201);

    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: eventA.slug } });
    const pending = await as(`/invitations/${eventA.slug}/template-upgrade-preview`)
      .send({ targetVersionId: published.body.versionId, expectedDesignRevision: String(invitation.designRevision) }).expect(202);
    await materializer.runOne();
    const ready = await http().get(pending.body.pollUrl as string).set('Authorization', admin.authorization).expect(200);
    const eventAssetPath = ready.body.payloads.en.coverUrl as string;
    const eventAssetId = (await prisma.invitationTemplateAsset.findFirstOrThrow({ where: { invitationId: invitation.id } })).id;

    const eventB = await seedEvent(prisma);
    const ownerB = await authenticateAs(app, prisma, { eventId: eventB.eventId, role: EventRole.OWNER });
    return { eventA, eventB, ownerB, templateKey, templateAssetId, eventAssetId, eventAssetPath, png };
  };

  const read = (path: string, authorization?: string) => {
    const call = http().get(path);
    return authorization ? call.set('Authorization', authorization) : call;
  };

  describe("an event's prepared copy", () => {
    it('is served to a designer of that event, privately and without a redirect', async () => {
      const tenants = await twoTenants();
      const designer = await authenticateAs(app, prisma, { eventId: tenants.eventA.eventId, role: EventRole.DESIGNER });

      const response = await read(tenants.eventAssetPath, designer.authorization).expect(200);

      expect(tenants.eventAssetPath).toBe(`/api/v1/events/${tenants.eventA.eventId}/design-assets/${tenants.eventAssetId}/file`);
      expect(response.headers['content-type']).toMatch(/^image\/png/);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers.location).toBeUndefined();
      expect((await sharp(response.body as Buffer).metadata())).toMatchObject({ width: 5, height: 7 });
    });

    it("is refused to another organization's owner asking through the first event", async () => {
      const tenants = await twoTenants();

      const response = await read(tenants.eventAssetPath, tenants.ownerB.authorization).expect(403);

      expect(response.headers['content-type']).toMatch(/^application\/json/);
    });

    it("is not found through another organization's own event", async () => {
      const tenants = await twoTenants();

      await read(`/api/v1/events/${tenants.eventB.eventId}/design-assets/${tenants.eventAssetId}/file`, tenants.ownerB.authorization).expect(404);
    });

    it('needs a session', async () => {
      const tenants = await twoTenants();

      await read(tenants.eventAssetPath).expect(401);
    });
  });

  describe("an organization's private catalogue sample", () => {
    const samplePath = (eventId: string, tenants: { templateKey: string; templateAssetId: string }) =>
      `/api/v1/events/${eventId}/design-templates/${tenants.templateKey}/assets/${tenants.templateAssetId}/file`;

    it('is served within the organization that owns the template', async () => {
      const tenants = await twoTenants();
      const viewer = await authenticateAs(app, prisma, { eventId: tenants.eventA.eventId, role: EventRole.VIEWER });

      const response = await read(samplePath(tenants.eventA.eventId, tenants), viewer.authorization).expect(200);

      expect(response.headers['content-type']).toMatch(/^image\/png/);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers.location).toBeUndefined();
      expect((await sharp(response.body as Buffer).metadata())).toMatchObject({ width: 5, height: 7 });
    });

    it("is not found through another organization's event", async () => {
      const tenants = await twoTenants();

      await read(samplePath(tenants.eventB.eventId, tenants), tenants.ownerB.authorization).expect(404);
    });

    it("is refused to another organization's owner asking through the owning event", async () => {
      const tenants = await twoTenants();

      await read(samplePath(tenants.eventA.eventId, tenants), tenants.ownerB.authorization).expect(403);
    });
  });
});
