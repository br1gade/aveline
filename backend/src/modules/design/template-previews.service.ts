import { artworkDefaultMedia, TemplateArtwork } from './templates/template-artwork';
import { readTemplateDefaultMedia } from './templates/template-materialization';
import { projectTemplateAssetPaths } from './templates/template-asset-paths';
import { pinnedTemplate } from './templates/template-content';
import { selectAvailableTemplate } from './templates/template-reader';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildInvitationContent } from '../invitations/invitation-content';
import { blockMediaSelect, invitationInclude } from '../invitations/invitations.service';
import { canRender, variantProblem } from './block-rules';
import { syntheticPreview } from './synthetic-preview';

@Injectable()
export class TemplatePreviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async catalogue(eventId: string, templateKey: string, locale?: string) {
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { organizationId: true } });
    const template = await this.requireTemplate(event.organizationId, templateKey);
    const templateVersion = await this.prisma.designTemplateVersion.findUniqueOrThrow({ where: { id: template.templateVersionId } });
    const synthetic = syntheticPreview(template); synthetic.templateVersion = templateVersion;
    synthetic.defaultMedia = artworkDefaultMedia(templateVersion.assetManifest as unknown as TemplateArtwork[], (assetId) => `/api/v1/events/${eventId}/design-templates/${templateKey}/assets/${assetId}/file`);
    return { ...buildInvitationContent(synthetic, locale), isPreview: true, previewSource: 'SYNTHETIC' as const, isAcceptingResponses: false };
  }

  async forEvent(slug: string, query: { templateKey?: string; locale?: string }) {
    const invitation = await this.prisma.invitation.findUnique({ where: { slug }, include: invitationInclude });
    if (!invitation) throw new NotFoundException('No such invitation');
    const template = query.templateKey ? await this.requireTemplate(invitation.organizationId, query.templateKey) : { ...pinnedTemplate(invitation), id: invitation.templateId, templateVersionId: invitation.templateVersionId };
    // Match switching: keep the current theme only when previewing the selected template.
    const theme = template.templateVersionId === invitation.templateVersionId ? invitation.theme : template.defaultTheme;
    const blocks = invitation.blocks.filter((block) => canRender(template, block.type)).map((block) => ({
      ...block, variant: variantProblem(template, block.type, block.variant) ? null : block.variant,
    }));
    const assets = await this.prisma.mediaAsset.findMany({ where: {
      eventId: invitation.eventId, id: { in: blocks.flatMap((block) => block.assetIds) }, kind: { in: ['PHOTO', 'COVER', 'LOGO', 'AUDIO'] },
    }, select: blockMediaSelect });
    const templateVersion = await this.prisma.designTemplateVersion.findUniqueOrThrow({ where: { id: template.templateVersionId } });
    const defaults = template.templateVersionId === invitation.templateVersionId ? (await readTemplateDefaultMedia(this.prisma, { invitationId: invitation.id, versionId: templateVersion.id })).media
      : artworkDefaultMedia(templateVersion.assetManifest as unknown as TemplateArtwork[], (assetId) => `/api/v1/events/${invitation.eventId}/design-templates/${template.key}/assets/${assetId}/file`);
    const payload = buildInvitationContent({ ...invitation, template, templateVersion, theme, blocks, defaultMedia: defaults, media: new Map(assets.map((asset) => [asset.id, asset])) }, query.locale);
    return { ...projectTemplateAssetPaths(payload, `/api/v1/events/${invitation.eventId}/design-assets`), isPreview: true, previewSource: 'EVENT' as const, isAcceptingResponses: false };
  }

  private async requireTemplate(organizationId: string, key: string) {
    const template = await selectAvailableTemplate(this.prisma, { organizationId, templateKey: key });
    if (!template) throw new NotFoundException('No such active template');
    return template;
  }
}
