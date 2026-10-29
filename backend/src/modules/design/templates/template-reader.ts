import { DomainHttpException } from '../../../common/domain-http.exception';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pinnedTemplate } from './template-content';

export interface TemplateSelection {
  organizationId: string;
  templateKey?: string;
  templateVersionId?: string;
}

/** Selection belongs inside the event creation transaction, before the event fence. */
export async function selectAvailableTemplate(tx: Prisma.TransactionClient, intent: TemplateSelection) {
  const template = await tx.designTemplate.findFirst({
    where: { isActive: true, retiredAt: null, key: intent.templateKey,
      OR: [{ organizationId: null }, { organizationId: intent.organizationId }],
      ...(intent.templateVersionId ? { versions: { some: { id: intent.templateVersionId } } } : {}),
    }, include: { activeVersion: true }, orderBy: [{ name: 'asc' }, { key: 'asc' }, { id: 'asc' }],
  });
  if (!template) {
    if (intent.templateKey || intent.templateVersionId) throw new DomainHttpException('TEMPLATE_NOT_FOUND', 'No available template in this event organization');
    return null;
  }
  await tx.$queryRaw`SELECT id FROM design_templates WHERE id=${template.id} FOR SHARE`;
  const current = await tx.designTemplate.findUniqueOrThrow({ where: { id: template.id }, include: { activeVersion: true } });
  assertAvailableScope(current, intent.organizationId);
  if (!current.activeVersion) throw new NotFoundException('No available template');
  if (intent.templateVersionId && current.activeVersionId !== intent.templateVersionId) throw new NotFoundException('This version is unavailable for new selection');
  return { ...pinnedTemplate({ template: current, templateVersion: current.activeVersion }), id: current.id,
    provenance: current.activeVersion.provenance, contentHash: current.activeVersion.contentHash, rendererKey: current.activeVersion.rendererKey, templateVersionId: current.activeVersion.id, templateOwnerScopeKey: current.ownerScopeKey };
}

export async function listEventTemplates(tx: Prisma.TransactionClient, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  if (!event) throw new NotFoundException('No such event');
  const templates = await tx.designTemplate.findMany({ where: { isActive: true, retiredAt: null,
    OR: [{ organizationId: null }, { organizationId: event.organizationId }], activeVersionId: { not: null } },
    include: { activeVersion: true }, orderBy: [{ name: 'asc' }, { key: 'asc' }, { id: 'asc' }] });
  return templates.flatMap((template) => template.activeVersion ? [{
    key: template.key, name: template.activeVersion.name, allowedFonts: template.activeVersion.allowedFonts,
    palettes: template.activeVersion.palettes, supportedBlocks: template.activeVersion.supportedBlocks,
    blockVariants: template.activeVersion.blockVariants, defaultTheme: template.activeVersion.defaultTheme,
    versionId: template.activeVersion.id, versionNumber: template.activeVersion.versionNumber,
    rendererKey: template.activeVersion.rendererKey, capabilityVersion: template.activeVersion.capabilityVersion,
    contentHash: template.activeVersion.contentHash, scope: template.organizationId ? 'ORGANIZATION' : 'SHARED',
  }] : []);
}

function assertAvailableScope(template: { isActive: boolean; retiredAt: Date | null; organizationId: string | null }, organizationId: string) {
  if (!template.isActive || template.retiredAt || (template.organizationId !== null && template.organizationId !== organizationId)) throw new NotFoundException('No available template');
}
