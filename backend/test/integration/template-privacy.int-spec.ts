import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TemplateAuthoringService } from '../../src/modules/design/templates/template-authoring.service';
import { TemplateGatesService } from '../../src/modules/design/templates/template-gates.service';
import { TemplateCapabilitiesService } from '../../src/modules/design/templates/capabilities/template-capabilities.service';
import { exportTemplateAuthorship, revokeTemplateAuthorship } from '../../src/modules/design/templates/template-privacy';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
const definition = { name: 'Private title', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
describe('template authorship privacy', () => {
  let prisma: PrismaClient; let author: TemplateAuthoringService;
  beforeAll(() => { prisma = testPrisma(); author = new TemplateAuthoringService(prisma as unknown as PrismaService,
    new TemplateGatesService(new ConfigService({ TEMPLATE_AUTHORING_ENABLED: 'true' })), new TemplateCapabilitiesService()); });
  beforeEach(() => resetTestDatabase()); afterAll(() => disconnectTestDatabase());
  it('exports only subject identity facts and revokes previews/assignments while retaining design history', async () => {
    const admin = await prisma.user.create({ data: { name: 'Admin', email: `${randomUUID()}@test.local`, platformRole: 'ADMIN' } });
    const support = await prisma.user.create({ data: { name: 'Support', email: `${randomUUID()}@test.local`, platformRole: 'SUPPORT' } });
    const template = await author.create(admin.id, { key: 'private-facts', definition });
    await author.assign(admin.id, template.templateId, { expectedRevision: 1, userId: support.id });
    await author.preview(support.id, { templateId: template.templateId, draftId: template.draft.id });
    const exported = await exportTemplateAuthorship(prisma, support.email.toUpperCase());
    expect(exported?.assignments).toHaveLength(1); expect(exported?.drafts).toHaveLength(0);
    expect(JSON.stringify(exported)).not.toContain('Private title'); expect(JSON.stringify(exported)).not.toContain(admin.id);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: support.id }, data: { isActive: false, deletedAt: new Date() } });
      await revokeTemplateAuthorship(tx, support.id, new Date());
    });
    await expect(author.read(support.id, template.templateId)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.templateAssignment.count({ where: { userId: support.id, revokedAt: null } })).toBe(0);
    expect(await prisma.templatePreview.count({ where: { actorUserId: support.id, expiresAt: { gt: new Date() } } })).toBe(0);
    expect(await prisma.templateDraft.count({ where: { templateId: template.templateId } })).toBe(1);
  });
});
