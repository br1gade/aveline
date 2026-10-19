import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildInvitationContent } from '../invitations/invitation-content';
import { blockMediaSelect, invitationInclude } from '../invitations/invitations.service';
import { canRender, variantProblem } from './block-rules';
import { syntheticPreview } from './synthetic-preview';

@Injectable()
export class TemplatePreviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async catalogue(templateKey: string, locale?: string) {
    const template = await this.requireTemplate(templateKey);
    return { ...buildInvitationContent(syntheticPreview(template), locale), isPreview: true, previewSource: 'SYNTHETIC' as const, isAcceptingResponses: false };
  }

  async forEvent(slug: string, query: { templateKey?: string; locale?: string }) {
    const invitation = await this.prisma.invitation.findUnique({ where: { slug }, include: invitationInclude });
    if (!invitation) throw new NotFoundException('No such invitation');
    const template = await this.requireTemplate(query.templateKey ?? invitation.template.key);
    // Match switching: keep the current theme only when previewing the selected template.
    const theme = template.id === invitation.templateId ? invitation.theme : template.defaultTheme;
    const blocks = invitation.blocks.filter((block) => canRender(template, block.type)).map((block) => ({
      ...block, variant: variantProblem(template, block.type, block.variant) ? null : block.variant,
    }));
    const assets = await this.prisma.mediaAsset.findMany({ where: {
      eventId: invitation.eventId, id: { in: blocks.flatMap((block) => block.assetIds) }, kind: { in: ['PHOTO', 'COVER', 'LOGO', 'AUDIO'] },
    }, select: blockMediaSelect });
    const payload = buildInvitationContent({ ...invitation, template, theme, blocks, media: new Map(assets.map((asset) => [asset.id, asset])) }, query.locale);
    return { ...payload, isPreview: true, previewSource: 'EVENT' as const, isAcceptingResponses: false };
  }

  private async requireTemplate(key: string) {
    const template = await this.prisma.designTemplate.findFirst({ where: { key, isActive: true } });
    if (!template) throw new NotFoundException('No such active template');
    return template;
  }
}
