import { BlockType, Prisma, PrismaClient } from '@prisma/client';
import { capabilityDigest, RendererCapability, TemplateCapabilitiesService } from '../../src/modules/design/templates/capabilities/template-capabilities.service';

/** Trusted synthetic capability exercises backend gates; it is never a production renderer assertion. */
export function testTemplateCapabilities(mediaSlots: string[] = []): TemplateCapabilitiesService {
  const content: Omit<RendererCapability, 'digest'> = { rendererKey: 'invitation-v1', capabilityVersion: 'backend-test-only-v1', schemaVersion: 1,
    frontendRevision: 'TEST_FIXTURE_NOT_DEPLOYED', locales: ['en', 'ru', 'fr', 'hy'], fonts: [{ id: 'Inter', bundledHash: 'a'.repeat(64) }],
    blocks: { HERO: { canDefault: true, variants: ['split'] } }, themeKeys: ['bodyFont', 'palette'], paletteRoles: { background: 0 }, mediaSlots };
  const service = new TemplateCapabilitiesService();
  jest.spyOn(service, 'approved').mockReturnValue([{ ...content, digest: capabilityDigest(content) }]);
  return service;
}

/** Arrange an explicit immutable fixture version, never a mutable published template. */
export async function reviseTemplateFixture(prisma: PrismaClient, intent: { where: Prisma.DesignTemplateWhereUniqueInput; data: { name?: string; allowedFonts?: string[]; palettes?: Prisma.InputJsonValue; supportedBlocks?: BlockType[]; blockVariants?: Prisma.InputJsonValue; defaultTheme?: Prisma.InputJsonValue; isActive?: boolean } }) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.designTemplate.findUniqueOrThrow({ where: intent.where, include: { activeVersion: true } });
    const baseline = template.activeVersion!;
    const version = await tx.designTemplateVersion.create({ data: { templateId: template.id, ownerScopeKey: template.ownerScopeKey,
      versionNumber: template.nextVersionNumber, name: intent.data.name ?? baseline.name,
      allowedFonts: intent.data.allowedFonts ?? baseline.allowedFonts, palettes: intent.data.palettes ?? baseline.palettes as Prisma.InputJsonValue,
      supportedBlocks: intent.data.supportedBlocks ?? baseline.supportedBlocks, blockVariants: intent.data.blockVariants ?? baseline.blockVariants as Prisma.InputJsonValue,
      defaultTheme: intent.data.defaultTheme ?? baseline.defaultTheme as Prisma.InputJsonValue, provenance: 'SEED_RELEASE', contentHash: 'explicit-test-fixture' } });
    await tx.designTemplate.update({ where: { id: template.id }, data: { activeVersionId: version.id, nextVersionNumber: { increment: 1 }, isActive: intent.data.isActive } });
    await tx.invitation.updateMany({ where: { templateId: template.id }, data: { templateVersionId: version.id } });
    return version;
  });
}
