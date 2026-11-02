import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlockType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrivateStorageService } from '../../src/infra/storage/private/private-storage';
import { EventsService } from '../../src/modules/events/events.service';
import { TemplateAuthoringService } from '../../src/modules/design/templates/template-authoring.service';
import { TemplateAssetsService } from '../../src/modules/design/templates/template-assets.service';
import { TemplateAssetRunner } from '../../src/modules/design/templates/template-asset-runner';
import { TemplateMaterializationRunner } from '../../src/modules/design/templates/template-materialization-runner';
import { TemplateCapabilitiesService, capabilityDigest } from '../../src/modules/design/templates/capabilities/template-capabilities.service';
import { PublishingService } from '../../src/modules/invitations/publishing.service';
import { seedEvent } from '../fixtures/event.fixture';
import { testTemplateCapabilities } from '../fixtures/template.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const definition = { name: 'Integration art', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO', 'RSVP'], blockVariants: { HERO: ['split'], RSVP: [] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
const input = { type: 'WEDDING' as const, title: 'New event', startsAt: '2030-06-12T15:00:00Z' };

function creationCapabilities() {
  const service = testTemplateCapabilities(['HERO']);
  const { digest: _digest, ...base } = service.approved()[0];
  const capability = { ...base, blocks: { ...base.blocks, RSVP: { canDefault: true, variants: [] } } };
  jest.mocked(service.approved).mockReturnValue([{ ...capability, digest: capabilityDigest(capability) }]);
  return service;
}

describe('event creation across organization and immutable template contracts', () => {
  const prisma = testPrisma();
  let module: TestingModule;
  let events: EventsService;
  const objects = new Map<string, Buffer>();
  const storage = { put: (key: string, buffer: Buffer) => { objects.set(key, buffer); return Promise.resolve(); }, get: (key: string) => Promise.resolve(objects.get(key)!), remove: (key: string) => { objects.delete(key); return Promise.resolve(); }, probe: () => Promise.resolve() };
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(PrivateStorageService).useValue(storage)
      .overrideProvider(TemplateCapabilitiesService).useValue(creationCapabilities())
      .compile();
    const config = module.get(ConfigService);
    for (const key of ['AUTHORING', 'ASSETS', 'PUBLISH', 'ADOPTION']) config.set(`TEMPLATE_${key}_ENABLED`, 'true');
    events = module.get(EventsService);
  });
  beforeEach(async () => { await resetTestDatabase(); objects.clear(); });
  afterAll(async () => { await module.close(); await disconnectTestDatabase(); });

  async function owner() {
    const seeded = await seedEvent(prisma);
    const existing = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, name: 'Owner' } });
    await prisma.organizationMembership.create({ data: { userId: user.id, organizationId: existing.organizationId, role: 'OWNER' } });
    return { seeded, user, organizationId: existing.organizationId };
  }

  async function authored(organizationId?: string, hasArtwork = false) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, name: 'Author', platformRole: 'ADMIN' } });
    const author = module.get(TemplateAuthoringService);
    const created = await author.create(user.id, { organizationId, ...(organizationId ? {} : { key: 'created-art' }), definition });
    let revision = 1;
    if (hasArtwork) {
      const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const assets = module.get(TemplateAssetsService);
      const upload = await assets.upload(user.id, { templateId: created.templateId, draftId: created.draft.id, expectedRevision: 1, kind: 'COVER', idempotencyKey: randomUUID(), file: { buffer, mimetype: 'image/png' } });
      await new TemplateAssetRunner(prisma as unknown as PrismaService, storage as unknown as PrivateStorageService).runOne();
      await assets.attach(user.id, { templateId: created.templateId, draftId: created.draft.id, expectedRevision: 2, artwork: [{ slot: 'HERO', assetId: upload.assetId }] });
      revision = 3;
    }
    const preview = await author.preview(user.id, { templateId: created.templateId, draftId: created.draft.id });
    await author.publish(user.id, { templateId: created.templateId, draftId: created.draft.id, dto: { expectedRevision: revision, contentHash: preview.contentHash, previewId: preview.previewId, idempotencyKey: randomUUID() } });
    const published = await prisma.designTemplate.findUniqueOrThrow({ where: { id: created.templateId } });
    if (!published.activeVersionId) throw new Error('Fixture publication is missing');
    return { ...created, versionId: published.activeVersionId };
  }

  it('uses the active immutable defaults and block order without upgrading an existing invitation', async () => {
    const state = await owner();
    const existing = await prisma.invitation.findUniqueOrThrow({ where: { slug: state.seeded.slug }, include: { templateVersion: true } });
    const { id: _id, ...baseline } = existing.templateVersion;
    const next = await prisma.designTemplateVersion.create({ data: { ...baseline, versionNumber: 2, palettes: baseline.palettes as Prisma.InputJsonValue, blockVariants: baseline.blockVariants as Prisma.InputJsonValue, assetManifest: [], rendererManifest: {}, defaultTheme: { bodyFont: 'Inter' }, supportedBlocks: [BlockType.COUNTDOWN, BlockType.HERO], contentHash: 'next-integration-version' } });
    await prisma.designTemplate.update({ where: { id: existing.templateId }, data: { activeVersionId: next.id } });
    const created = await events.create(state.organizationId, state.user.id, { ...input, templateKey: 'test-template' });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { eventId: created.id }, include: { blocks: { orderBy: { sortOrder: 'asc' } } } });
    expect(invitation.templateVersionId).toBe(next.id);
    expect(invitation.theme).toEqual(next.defaultTheme);
    expect(invitation.blocks.map((block) => block.type)).toEqual(next.supportedBlocks);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: existing.id } })).templateVersionId).toBe(existing.templateVersionId);
  });

  it('masks a foreign private template before creating any event', async () => {
    const state = await owner();
    const foreign = await prisma.organization.create({ data: { name: 'Other customer' } });
    const template = await authored(foreign.id);
    await expect(events.create(state.organizationId, state.user.id, { ...input, templateKey: template.key })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.event.count()).toBe(1);
  });

  it('refuses a requested version that is not the active selection before any event write', async () => {
    const state = await owner();
    const dto = { ...input, templateKey: 'test-template', templateVersionId: 'missing-version' };
    await expect(events.create(state.organizationId, state.user.id, dto)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.event.count()).toBe(1);
  });

  it('recovers a missing invitation through the same pinned and private-artwork preparation path', async () => {
    const state = await owner();
    const template = await authored(undefined, true);
    const event = await prisma.event.create({ data: { organizationId: state.organizationId, type: 'WEDDING', title: 'Recover', hostsLabel: 'A and B', startsAt: new Date(input.startsAt) } });
    const result = await events.createInvitation(event.id, state.user.id, { templateKey: template.key, templateVersionId: template.versionId });
    expect(result).toMatchObject({ status: 'DRAFT', template: { key: template.key }, templateSetup: { state: 'PROCESSING' } });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { eventId: event.id } });
    expect(invitation.theme).toEqual(definition.defaultTheme);
    expect(invitation.templateVersionId).toBe(template.versionId);
    expect(await prisma.templateMaterialization.count({ where: { invitationId: invitation.id } })).toBe(1);
    await expect(events.createInvitation(event.id, state.user.id, { templateKey: template.key })).rejects.toMatchObject({ status: 400 });
    expect(await prisma.templateMaterialization.count({ where: { invitationId: invitation.id } })).toBe(1);
  });

  it('still creates a draft event with no invitation when no template is available', async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, name: 'First owner', organizationMemberships: { create: { role: 'OWNER', organization: { create: { name: 'First organization' } } } } }, include: { organizationMemberships: true } });
    const result = await events.create(user.organizationMemberships[0].organizationId, user.id, input);
    expect(result.invitation).toBeNull();
    expect(result.status).toBe('DRAFT');
    expect(await prisma.templateMaterialization.count()).toBe(0);
  });

  it('reserves initial private artwork in the creation transaction and publishes only after worker binding', async () => {
    const state = await owner();
    const template = await authored(undefined, true);
    const created = await events.create(state.organizationId, state.user.id, { ...input, templateKey: template.key });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { eventId: created.id } });
    expect(invitation.templateVersionId).toBe(template.versionId);
    await prisma.venue.create({ data: { eventId: created.id, role: 'RECEPTION', name: 'Prepared venue', address: '1 Test Street' } });
    expect(await prisma.templateMaterialization.count({ where: { invitationId: invitation.id, isInitialSelection: true } })).toBe(1);
    await expect(module.get(PublishingService).publish(invitation.slug)).rejects.toMatchObject({ status: 409 });
    const worker = new TemplateMaterializationRunner(prisma as unknown as PrismaService, storage as unknown as PrivateStorageService);
    expect(await worker.runOne()).toBe(true);
    expect(await module.get(PublishingService).publish(invitation.slug)).toMatchObject({ status: 'PUBLISHED' });
  });
});
