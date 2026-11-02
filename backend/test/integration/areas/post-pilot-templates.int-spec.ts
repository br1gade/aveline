import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CacheService } from '../../../src/infra/cache/cache.service';
import { PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { TemplateAdoptionService } from '../../../src/modules/design/templates/template-adoption.service';
import { TemplateAssetsService } from '../../../src/modules/design/templates/template-assets.service';
import { TemplateAuthoringService } from '../../../src/modules/design/templates/template-authoring.service';
import { TemplateGatesService } from '../../../src/modules/design/templates/template-gates.service';
import { listEventTemplates } from '../../../src/modules/design/templates/template-reader';
import { seedEvent } from '../../fixtures/event.fixture';
import { testTemplateCapabilities } from '../../fixtures/template.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * docs/API.md, "Immutable invitation templates and controlled authoring":
 * one open draft per template; discarded and published drafts are frozen;
 * retire disables future selection; previews are requester-bound.
 */
const definition = { name: 'Invitation', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
const FLAGS = { TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true', TEMPLATE_ASSETS_ENABLED: 'true', TEMPLATE_ADOPTION_ENABLED: 'true' };

describe('template drafts, publication and adoption (integration coverage)', () => {
  let prisma: PrismaClient;
  let author: TemplateAuthoringService;
  let assets: TemplateAssetsService;
  let adoption: TemplateAdoptionService;
  const storage = { put: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.reject(new Error('not stored'))), remove: jest.fn(() => Promise.resolve()) };
  beforeAll(() => {
    prisma = testPrisma();
    const database = prisma as unknown as PrismaService;
    const gates = new TemplateGatesService(new ConfigService(FLAGS));
    const capabilities = testTemplateCapabilities(['HERO']);
    author = new TemplateAuthoringService(database, gates, capabilities);
    assets = new TemplateAssetsService(database, storage as unknown as PrivateStorageService, gates, capabilities);
    adoption = new TemplateAdoptionService(database, { invalidateInvitation: jest.fn() } as unknown as CacheService, gates);
  });
  beforeEach(async () => { await resetTestDatabase(); jest.clearAllMocks(); });
  afterAll(() => disconnectTestDatabase());

  const admin = () => prisma.user.create({ data: { name: 'Admin', email: `${randomUUID()}@test.local`, platformRole: 'ADMIN' } });
  async function published(key = 'authored') {
    const user = await admin();
    const template = await author.create(user.id, { key, definition });
    const preview = await author.preview(user.id, { templateId: template.templateId, draftId: template.draft.id });
    const version = await author.publish(user.id, { templateId: template.templateId, draftId: template.draft.id, dto: { expectedRevision: 1, previewId: preview.previewId, contentHash: preview.contentHash, idempotencyKey: randomUUID() } }) as { versionId: string };
    const { revision } = await prisma.designTemplate.findUniqueOrThrow({ where: { id: template.templateId } });
    return { userId: user.id, templateId: template.templateId, key, firstDraftId: template.draft.id, versionId: version.versionId, revision };
  }
  const draftState = (id: string) => prisma.templateDraft.findUniqueOrThrow({ where: { id }, select: { state: true, revision: true } });

  describe('draft lifecycle', () => {
    it('refuses a second open draft while one is open', async () => {
      const { userId, templateId } = await published();
      const before = await prisma.designTemplate.findUniqueOrThrow({ where: { id: templateId } });
      await author.openDraft(userId, templateId, before.revision);
      await expect(author.openDraft(userId, templateId, before.revision + 1)).rejects.toMatchObject({ status: 409, message: 'An open draft already exists' });
      expect(await prisma.templateDraft.count({ where: { templateId, state: 'OPEN' } })).toBe(1);
    });

    it('freezes a discarded draft against PATCH, artwork and upload, then allows a fresh draft', async () => {
      const { userId, templateId, revision } = await published();
      const draft = await author.openDraft(userId, templateId, revision);
      await author.discard(userId, { templateId, draftId: draft.id, expectedRevision: draft.revision });
      const frozen = await draftState(draft.id);
      expect(frozen.state).toBe('DISCARDED');
      const target = { templateId, draftId: draft.id };
      await expect(author.patch(userId, { ...target, dto: { expectedRevision: frozen.revision, definition: { name: 'Changed' } } })).rejects.toMatchObject({ status: 409, message: 'This draft is frozen' });
      await expect(assets.attach(userId, { ...target, expectedRevision: frozen.revision, artwork: [] })).rejects.toMatchObject({ status: 409, message: 'This draft is frozen' });
      const upload = { ...target, expectedRevision: frozen.revision, idempotencyKey: randomUUID(), kind: 'COVER', file: { buffer: Buffer.from('png'), mimetype: 'image/png' } };
      await expect(assets.upload(userId, upload)).rejects.toMatchObject({ status: 409, message: 'This draft is frozen' });
      expect(await draftState(draft.id)).toEqual(frozen);
      expect(await prisma.designTemplateStoredObject.count()).toBe(0);
      expect(storage.put).not.toHaveBeenCalled();
      const current = await prisma.designTemplate.findUniqueOrThrow({ where: { id: templateId } });
      expect((await author.openDraft(userId, templateId, current.revision)).state).toBe('OPEN');
    });

    it('freezes the published draft against PATCH and discard', async () => {
      const { userId, templateId, firstDraftId } = await published();
      expect((await draftState(firstDraftId)).state).toBe('PUBLISHED');
      await expect(author.patch(userId, { templateId, draftId: firstDraftId, dto: { expectedRevision: 1, definition: { name: 'Changed' } } })).rejects.toMatchObject({ status: 409, message: 'This draft is frozen' });
      await expect(author.discard(userId, { templateId, draftId: firstDraftId, expectedRevision: 1 })).rejects.toMatchObject({ status: 409, message: 'This draft is frozen' });
      expect((await draftState(firstDraftId)).state).toBe('PUBLISHED');
    });

    it('refuses an invalid PATCH with field-named TEMPLATE_VALIDATION_FAILED details and keeps the draft', async () => {
      const user = await admin();
      const template = await author.create(user.id, { key: 'invalid-patch', definition });
      const patch = author.patch(user.id, { templateId: template.templateId, draftId: template.draft.id, dto: { expectedRevision: 1, definition: { allowedFonts: ['Remote Font'], css: 'body{}' } } });
      await expect(patch).rejects.toMatchObject({ status: 400, response: { message: expect.arrayContaining([expect.stringMatching(/^allowedFonts: /), 'css: unknown field']) as unknown } });
      expect(await draftState(template.draft.id)).toEqual({ state: 'OPEN', revision: 1 });
    });

    it('validates an open draft as publishable under a tested capability', async () => {
      const user = await admin();
      const template = await author.create(user.id, { key: 'validated', definition });
      expect(await author.validate(user.id, { templateId: template.templateId, draftId: template.draft.id })).toMatchObject({ errors: [], canPublish: true, rendererAcceptance: 'TESTED_CAPABILITY' });
    });
  });

  describe('publication and retirement', () => {
    it('allocates exactly one version when two publishes race with different idempotency keys', async () => {
      const user = await admin();
      const template = await author.create(user.id, { key: 'raced', definition });
      const preview = await author.preview(user.id, { templateId: template.templateId, draftId: template.draft.id });
      const publish = () => author.publish(user.id, { templateId: template.templateId, draftId: template.draft.id, dto: { expectedRevision: 1, previewId: preview.previewId, contentHash: preview.contentHash, idempotencyKey: randomUUID() } });
      const results = await Promise.allSettled([publish(), publish()]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
      expect(await prisma.designTemplateVersion.count({ where: { templateId: template.templateId } })).toBe(1);
      expect(await prisma.templateReceipt.count({ where: { scopeKey: template.templateId } })).toBe(1);
    });

    it('removes a retired template from the event catalogue and refuses a new adoption preview', async () => {
      const { userId, templateId, key, versionId, revision } = await published();
      const event = await seedEvent(prisma);
      const catalogue = () => prisma.$transaction((tx) => listEventTemplates(tx, event.eventId));
      expect((await catalogue()).map((entry) => entry.key)).toContain(key);
      await author.retire(userId, templateId, revision);
      expect((await catalogue()).map((entry) => entry.key)).not.toContain(key);
      const designer = await prisma.user.create({ data: { name: 'Designer', email: `${randomUUID()}@test.local`, eventMemberships: { create: { eventId: event.eventId, role: 'DESIGNER' } } } });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
      await expect(adoption.preview(designer.id, event.slug, { targetVersionId: versionId, expectedDesignRevision: String(invitation.designRevision) })).rejects.toMatchObject({ status: 409, message: 'The target is no longer selectable' });
      expect(await prisma.templatePreview.count({ where: { invitationId: invitation.id } })).toBe(0);
    });
  });

  describe('adoption', () => {
    it('refuses applying a preview that was issued to a different designer', async () => {
      const event = await seedEvent(prisma);
      const designer = (name: string) => prisma.user.create({ data: { name, email: `${randomUUID()}@test.local`, eventMemberships: { create: { eventId: event.eventId, role: 'DESIGNER' } } } });
      const [first, second] = [await designer('First'), await designer('Second')];
      const target = await prisma.designTemplate.create({ data: { key: randomUUID(), name: 'Target', supportedBlocks: ['HERO'] } });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
      const intent = { targetVersionId: `${target.id}:baseline`, expectedDesignRevision: String(invitation.designRevision) };
      const preview = await adoption.preview(first.id, event.slug, intent);
      const confirm = { ...intent, templateKey: target.key, expectedTemplateVersionId: invitation.templateVersionId, previewId: preview.previewId };
      await expect(adoption.apply(second.id, event.slug, { ...confirm, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409, code: 'TEMPLATE_PREVIEW_STALE' });
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).templateVersionId).toBe(invitation.templateVersionId);
      expect(await prisma.templateReceipt.count()).toBe(0);
      await adoption.apply(first.id, event.slug, { ...confirm, idempotencyKey: randomUUID() });
      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).templateVersionId).toBe(intent.targetVersionId);
    });

    it('refuses polling a preview that was issued to a different designer', async () => {
      const event = await seedEvent(prisma);
      const designer = (name: string) => prisma.user.create({ data: { name, email: `${randomUUID()}@test.local`, eventMemberships: { create: { eventId: event.eventId, role: 'DESIGNER' } } } });
      const [first, second] = [await designer('First'), await designer('Second')];
      const target = await prisma.designTemplate.create({ data: { key: randomUUID(), name: 'Target', supportedBlocks: ['HERO'] } });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
      const preview = await adoption.preview(first.id, event.slug, { targetVersionId: `${target.id}:baseline`, expectedDesignRevision: String(invitation.designRevision) });
      await expect(adoption.poll(second.id, event.slug, preview.previewId)).rejects.toMatchObject({ status: 409, code: 'TEMPLATE_PREVIEW_STALE', message: 'Preview expired or belongs to another requester' });
      expect(await adoption.poll(first.id, event.slug, preview.previewId)).toMatchObject({ previewId: preview.previewId });
    });
  });
});
