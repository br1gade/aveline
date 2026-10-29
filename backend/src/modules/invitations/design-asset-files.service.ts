import { selectAvailableTemplate } from '../design/templates/template-reader';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateStorageService } from '../../infra/storage/private/private-storage';
import { lockOrganizationStanding, requireCurrentEventPermission } from '../../infra/auth/access-locks';
import { InvitationsService } from './invitations.service';
@Injectable()
export class DesignAssetFilesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService, private readonly invitations: InvitationsService) {}
  async readGuest(intent: { slug: string; token?: string; assetId: string }) {
    const scope = await this.invitations.assertDesignAssetReadable(intent.slug, intent.token);
    const asset = await this.requireFile({ assetId: intent.assetId, eventId: scope.eventId, slug: intent.slug });
    const buffer = await this.storage.get(asset.objectKey);
    await this.invitations.assertDesignAssetReadable(intent.slug, intent.token);
    const current = await this.requireFile({ assetId: intent.assetId, eventId: scope.eventId, slug: intent.slug });
    if (current.objectKey !== asset.objectKey) throw new NotFoundException('Design artwork unavailable');
    return { buffer, mimeType: asset.mimeType };
  }
  async readEditor(userId: string, intent: { eventId: string; assetId: string }) {
    await this.requireEditor(userId, intent.eventId);
    const asset = await this.requireFile(intent);
    const buffer = await this.storage.get(asset.objectKey);
    await this.requireEditor(userId, intent.eventId); await this.requireFile(intent);
    return { buffer, mimeType: asset.mimeType };
  }
  async readCatalogue(userId: string, intent: { eventId: string; templateKey: string; assetId: string }) {
    await this.requireEditor(userId, intent.eventId);
    const asset = await this.requireCatalogueAsset(intent); const buffer = await this.storage.get(asset.sanitizedKey!);
    await this.requireEditor(userId, intent.eventId); await this.requireCatalogueAsset(intent);
    return { buffer, mimeType: asset.mimeType ?? 'image/png' };
  }
  private requireCatalogueAsset(intent: { eventId: string; templateKey: string; assetId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.findUniqueOrThrow({ where: { id: intent.eventId }, select: { organizationId: true } });
      await lockOrganizationStanding(tx, { organizationId: event.organizationId });
      const template = await selectAvailableTemplate(tx, { organizationId: event.organizationId, templateKey: intent.templateKey });
      if (!template) throw new NotFoundException('No such template artwork');
      const reference = await tx.designTemplateAssetReference.findFirst({ where: { versionId: template.templateVersionId, assetId: intent.assetId } });
      const asset = await tx.designTemplateAsset.findFirst({ where: { id: intent.assetId, templateId: template.id, state: 'AVAILABLE' } });
      if (!reference || !asset?.sanitizedKey) throw new NotFoundException('No such template artwork');
      return asset;
    });
  }
  private requireEditor(userId: string, eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { organizationId: true } });
      await lockOrganizationStanding(tx, { organizationId: event.organizationId });
      await requireCurrentEventPermission(tx, { actor: { userId }, eventId, permission: 'invitation:read' });
    });
  }
  private async requireFile(intent: { eventId: string; assetId: string; slug?: string }) {
    const rows = await this.prisma.$queryRaw<{ objectKey: string; mimeType: string }[]>`SELECT a."objectKey",a."mimeType" FROM invitation_template_assets a
      JOIN template_materializations m ON m.id=a."materializationId" JOIN design_template_stored_objects o ON o.key=a."objectKey"
      JOIN design_template_assets source ON source.id=a."sourceAssetId"
      JOIN invitations i ON i.id=a."invitationId" AND i."eventId"=a."eventId"
      WHERE a.id=${intent.assetId} AND a."eventId"=${intent.eventId} AND o.state='AVAILABLE' AND source.state='AVAILABLE'
      AND (${intent.slug ?? null}::text IS NULL OR i.slug=${intent.slug ?? null})
      AND (a.state='BOUND' AND i."templateVersionId"=a."templateVersionId" OR ${!intent.slug} AND a.state='AVAILABLE' AND m.state='READY' AND m."expiresAt">now())`;
    if (!rows[0]) throw new NotFoundException('Design artwork unavailable');
    return rows[0];
  }
}
