import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrivateStorageService } from '../../src/infra/storage/private/private-storage';
import { TemplateAssetsService } from '../../src/modules/design/templates/template-assets.service';
import { TemplateAssetRunner } from '../../src/modules/design/templates/template-asset-runner';
import { TemplateAuthoringService } from '../../src/modules/design/templates/template-authoring.service';
import { TemplateGatesService } from '../../src/modules/design/templates/template-gates.service';
import { TemplateCapabilitiesService } from '../../src/modules/design/templates/capabilities/template-capabilities.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
const definition = { name: 'Art', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
describe('template private artwork ledger', () => {
  let prisma: PrismaClient; let assets: TemplateAssetsService; let runner: TemplateAssetRunner; let author: TemplateAuthoringService;
  const objects = new Map<string, Buffer>();
  const storage = { put: jest.fn((key: string, buffer: Buffer) => { objects.set(key, buffer); return Promise.resolve(); }),
    get: jest.fn((key: string) => Promise.resolve(objects.get(key)!)), remove: jest.fn((key: string) => { objects.delete(key); return Promise.resolve(); }) };
  beforeAll(() => {
    prisma = testPrisma(); const database = prisma as unknown as PrismaService; const store = storage as unknown as PrivateStorageService;
    const gates = new TemplateGatesService(new ConfigService({ TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_ASSETS_ENABLED: 'true' }));
    assets = new TemplateAssetsService(database, store, gates, new TemplateCapabilitiesService()); runner = new TemplateAssetRunner(database, store);
    author = new TemplateAuthoringService(database, gates, new TemplateCapabilitiesService());
  });
  beforeEach(async () => { await resetTestDatabase(); objects.clear(); jest.clearAllMocks(); }); afterAll(() => disconnectTestDatabase());
  const setup = async () => {
    const user = await prisma.user.create({ data: { name: 'Admin', email: `${randomUUID()}@test.local`, platformRole: 'ADMIN' } });
    const template = await author.create(user.id, { key: 'art', definition });
    const buffer = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const upload = await assets.upload(user.id, { templateId: template.templateId, draftId: template.draft.id, expectedRevision: 1, kind: 'COVER', idempotencyKey: randomUUID(), file: { buffer, mimetype: 'image/png' } });
    return { user, templateId: template.templateId, draftId: template.draft.id, upload };
  };
  it('sanitizes in the worker and cleans retired bytes with durable late-upload tombstones', async () => {
    const state = await setup(); expect(state.upload.state).toBe('PROCESSING');
    expect(await runner.runOne()).toBe(true);
    expect(await assets.read(state.user.id, { templateId: state.templateId, assetId: state.upload.assetId })).toMatchObject({ mimeType: 'image/png' });
    const asset = await prisma.designTemplateAsset.findUniqueOrThrow({ where: { id: state.upload.assetId } });
    await assets.remove(state.user.id, { templateId: state.templateId, draftId: state.draftId, assetId: asset.id, expectedRevision: 2 });
    await runner.cleanup();
    expect(objects.size).toBe(0);
    objects.set(asset.sanitizedKey!, Buffer.from('late stale worker'));
    await prisma.designTemplateStoredObject.updateMany({ where: { assetId: asset.id }, data: { cleanupAfter: new Date(0) } });
    await runner.cleanup(); expect(objects.size).toBe(0);
    expect(await prisma.designTemplateStoredObject.count({ where: { state: 'DELETED' } })).toBe(2);
  });
  it('checks current account authority after storage reads', async () => {
    const state = await setup(); await runner.runOne();
    storage.get.mockImplementationOnce(async (key: string) => { await prisma.user.update({ where: { id: state.user.id }, data: { isActive: false } }); return objects.get(key)!; });
    await expect(assets.read(state.user.id, { templateId: state.templateId, assetId: state.upload.assetId })).rejects.toMatchObject({ status: 403 });
  });
});
