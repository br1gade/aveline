import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { selectAvailableTemplate } from '../design/templates/template-reader';
import { reserveInitialTemplateArtwork } from '../design/templates/template-materialization';
import { defaultBlocksFor } from './default-blocks';
import { invitationSlug } from './invitation-slug';

interface InvitationCreation {
  eventId: string;
  organizationId: string;
  userId: string;
  hostsLabel: string;
  template: NonNullable<Awaited<ReturnType<typeof selectAvailableTemplate>>>;
}

/** The caller holds organization, selected-template, event and current-user fences. */
export async function createEventInvitation(tx: Prisma.TransactionClient, input: InvitationCreation) {
  const { template } = input;
  const invitation = await tx.invitation.create({
    data: {
      eventId: input.eventId,
      organizationId: input.organizationId,
      slug: invitationSlug(input.hostsLabel, randomBytes(4).toString('hex')),
      templateId: template.id,
      templateVersionId: template.templateVersionId,
      templateOwnerScopeKey: template.templateOwnerScopeKey,
      theme: template.defaultTheme === null ? Prisma.JsonNull : template.defaultTheme as Prisma.InputJsonValue,
      blocks: { create: defaultBlocksFor(template.supportedBlocks) },
    },
    select: { id: true, eventId: true, organizationId: true, templateVersionId: true, slug: true, status: true, template: { select: { key: true } } },
  });
  const preparation = await reserveInitialTemplateArtwork(tx, { userId: input.userId, invitation });
  return { slug: invitation.slug, status: invitation.status, template: invitation.template,
    templateSetup: preparation.state === 'PROCESSING' ? preparation : undefined };
}
