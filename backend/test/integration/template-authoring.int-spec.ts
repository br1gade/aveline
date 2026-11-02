import { testTemplateCapabilities } from '../fixtures/template.fixture';
import { TemplateCapabilitiesService } from '../../src/modules/design/templates/capabilities/template-capabilities.service';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TemplateAuthoringService } from '../../src/modules/design/templates/template-authoring.service';
import { TemplateGatesService } from '../../src/modules/design/templates/template-gates.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const definition = { name: 'Invitation', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
describe('controlled template authoring', () => {
  let prisma: PrismaClient; let service: TemplateAuthoringService;
  beforeAll(() => {
    prisma = testPrisma();
    service = new TemplateAuthoringService(prisma as unknown as PrismaService, new TemplateGatesService(new ConfigService({ TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true' })), new TemplateCapabilitiesService());
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());
  const staff = (platformRole: 'ADMIN' | 'SUPPORT' | 'NONE') => prisma.user.create({ data: { email: `${randomUUID()}@test.local`, name: 'Staff', platformRole } });
  it('requires active explicit SUPPORT assignment and revokes it without adding membership', async () => {
    const admin = await staff('ADMIN'); const support = await staff('SUPPORT');
    const template = await service.create(admin.id, { key: 'new-template', definition });
    await expect(service.read(support.id, template.templateId)).rejects.toMatchObject({ status: 403 });
    await service.assign(admin.id, template.templateId, { expectedRevision: 1, userId: support.id });
    expect(await service.read(support.id, template.templateId)).toMatchObject({ id: template.templateId });
    expect(await prisma.organizationMembership.count({ where: { userId: support.id } })).toBe(0);
    await service.assign(admin.id, template.templateId, { expectedRevision: 2, userId: support.id }, true);
    await expect(service.read(support.id, template.templateId)).rejects.toMatchObject({ status: 403 });
  });
  it('serializes concurrent expected-revision edits and never opens publication via a flag', async () => {
    const admin = await staff('ADMIN'); const template = await service.create(admin.id, { key: 'new-template', definition });
    const intent = { templateId: template.templateId, draftId: template.draft.id, dto: { expectedRevision: 1, definition: { name: 'Changed' } } };
    const results = await Promise.allSettled([service.patch(admin.id, intent), service.patch(admin.id, intent)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const preview = await service.preview(admin.id, intent);
    expect(preview).toMatchObject({ canPublish: false, rendererAcceptance: 'PAYLOAD_ONLY' });
    expect(Object.keys(preview.payloads)).toEqual(['en', 'ru', 'fr', 'hy']);
    await expect(service.publish(admin.id, { ...intent, dto: { expectedRevision: 2, previewId: preview.previewId, contentHash: preview.contentHash, idempotencyKey: randomUUID() } })).rejects.toMatchObject({ status: 503 });
    expect(await prisma.designTemplateVersion.count({ where: { templateId: template.templateId, provenance: 'AUTHORED' } })).toBe(0);
  });
  it('keeps private keys opaque and denies customer authoring', async () => {
    const admin = await staff('ADMIN'); const customer = await staff('NONE');
    const organization = await prisma.organization.create({ data: { name: 'Customer', kind: 'HOST' } });
    const template = await service.create(admin.id, { organizationId: organization.id, definition });
    expect(template.key).toMatch(/^private-[0-9a-f-]+$/);
    await expect(service.read(customer.id, template.templateId)).rejects.toMatchObject({ status: 403 });
    await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'NONE' } });
    await expect(service.read(admin.id, template.templateId)).rejects.toMatchObject({ status: 403 });
  });
});


describe('backend publication with a trusted synthetic capability', () => {
  let prisma: PrismaClient; let service: TemplateAuthoringService;
  beforeAll(() => {
    prisma = testPrisma();
    service = new TemplateAuthoringService(prisma as unknown as PrismaService, new TemplateGatesService(new ConfigService({ TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true' })), testTemplateCapabilities());
  });
  beforeEach(() => resetTestDatabase()); afterAll(() => disconnectTestDatabase());
  it('publishes once atomically and returns the receipt after the draft is frozen', async () => {
    const admin = await prisma.user.create({ data: { name: 'Admin', email: `${randomUUID()}@test.local`, platformRole: 'ADMIN' } });
    const template = await service.create(admin.id, { key: 'published', definition });
    expect(await prisma.designTemplateVersion.count()).toBe(0);
    const preview = await service.preview(admin.id, { templateId: template.templateId, draftId: template.draft.id });
    expect(preview).toMatchObject({ canPublish: true, rendererAcceptance: 'TESTED_CAPABILITY' });
    const intent = { templateId: template.templateId, draftId: template.draft.id, dto: { expectedRevision: 1, previewId: preview.previewId, contentHash: preview.contentHash, idempotencyKey: randomUUID() } };
    const first = await service.publish(admin.id, intent);
    expect(await service.publish(admin.id, intent)).toEqual(first);
    expect(await prisma.designTemplateVersion.count()).toBe(1);
    expect(await prisma.templateDraft.findUniqueOrThrow({ where: { id: template.draft.id } })).toMatchObject({ state: 'PUBLISHED' });
    await expect(service.publish(admin.id, { ...intent, dto: { ...intent.dto, contentHash: 'different' } })).rejects.toMatchObject({ status: 409 });
    const detail = await service.read(admin.id, template.templateId);
    await service.retire(admin.id, template.templateId, detail.revision);
    expect(await prisma.designTemplateVersion.count()).toBe(1);
  });
});
