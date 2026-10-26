import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequestActor, actorCan } from '../../../infra/auth/actor';
import { invitationInclude, blockMediaSelect } from '../../invitations/invitations.service';
import { buildInvitationContent } from '../../invitations/invitation-content';
import { CacheService } from '../../../infra/cache/cache.service';
import { hashTemplateContent, pinnedTemplate } from './template-content';
import { selectAvailableTemplate } from './template-reader';
import { planTemplateAdoption } from './template-adoption';
import { TemplateGatesService } from './template-gates.service';

const adoptionInclude = { ...invitationInclude, blocks: { orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }] } } satisfies Prisma.InvitationInclude;
type AdoptionInvitation = Prisma.InvitationGetPayload<{ include: typeof adoptionInclude }>;
export interface UpgradePreviewIntent { targetVersionId: string; expectedDesignRevision: string }
export interface UpgradeApplyIntent extends UpgradePreviewIntent { templateKey: string; previewId: string; expectedTemplateVersionId: string; idempotencyKey: string }
@Injectable()
export class TemplateAdoptionService {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService, private readonly gates: TemplateGatesService) {}
  async preview(userId: string, slug: string, intent: UpgradePreviewIntent) {
    this.gates.require('ADOPTION');
    return this.prisma.$transaction(async (tx) => {
      const { invitation, target } = await lockAdoption(tx, { userId, slug, targetVersionId: intent.targetVersionId });
      assertDesignRevision(invitation.designRevision, intent.expectedDesignRevision);
      const source = await loadSource(tx, invitation);
      const plan = planTemplateAdoption(invitation, target);
      const preview = await tx.templatePreview.create({ data: { templateId: target.templateId, invitationId: invitation.id, actorUserId: userId,
        sourceHash: source.hash, targetHash: target.contentHash, targetVersionId: target.id, sourceVersionId: invitation.templateVersionId,
        designRevision: invitation.designRevision, expiresAt: new Date(Date.now() + 900000) } });
      const payloads = Object.fromEntries(invitation.event.locales.map((locale) => [locale, { ...buildInvitationContent({ ...invitation, ...plan,
        blocks: plan.blocks.filter((block) => block.enabled), template: { ...target, id: target.templateId, key: target.key }, media: source.media }, locale),
        isPreview: true, isAcceptingResponses: false }]));
      return { previewId: preview.id, sourceVersionId: invitation.templateVersionId, targetVersionId: target.id,
        expectedDesignRevision: String(invitation.designRevision), sourceHash: source.hash, targetHash: target.contentHash,
        expiresAt: preview.expiresAt, changes: plan.changes, payloads };
    }, { isolationLevel: 'RepeatableRead' });
  }
  async apply(userId: string, slug: string, intent: UpgradeApplyIntent) {
    this.gates.require('ADOPTION'); const requestHash = hashTemplateContent({ slug, ...intent });
    const result = await this.prisma.$transaction(async (tx) => {
      const { invitation, target } = await lockAdoption(tx, { userId, slug, targetVersionId: intent.targetVersionId });
      const scopeKey = `adopt:${invitation.id}`;
      const prior = await tx.templateReceipt.findUnique({ where: { scopeKey_idempotencyKey: { scopeKey, idempotencyKey: intent.idempotencyKey } } });
      if (prior) {
        if (prior.actorUserId !== userId || prior.requestHash !== requestHash) throw new ConflictException('TEMPLATE_IDEMPOTENCY_CONFLICT');
        return prior.result;
      }
      if (intent.templateKey !== target.key || intent.expectedTemplateVersionId !== invitation.templateVersionId) throw new ConflictException('TEMPLATE_PREVIEW_STALE');
      assertDesignRevision(invitation.designRevision, intent.expectedDesignRevision);
      const source = await loadSource(tx, invitation);
      await requireUpgradePreview(tx, { invitation, userId, sourceHash: source.hash, target, previewId: intent.previewId });
      const plan = planTemplateAdoption(invitation, target);
      await tx.invitation.update({ where: { id: invitation.id }, data: { templateId: target.templateId, templateVersionId: target.id,
        templateOwnerScopeKey: target.ownerScopeKey, theme: plan.theme as Prisma.InputJsonValue } });
      await Promise.all(plan.blocks.map((block) => tx.invitationBlock.update({ where: { id: block.id }, data: { enabled: block.enabled, variant: block.variant } })));
      const after = await tx.invitation.findUniqueOrThrow({ where: { id: invitation.id }, select: { designRevision: true } });
      const value = { slug, templateVersionId: target.id, designRevision: String(after.designRevision), changes: plan.changes };
      await tx.templateReceipt.create({ data: { scopeKey, idempotencyKey: intent.idempotencyKey, actorUserId: userId, requestHash, result: value } });
      return value;
    });
    await this.cache.invalidateInvitation(slug); return result;
  }
}
async function lockAdoption(tx: Prisma.TransactionClient, intent: { userId: string; slug: string; targetVersionId: string }) {
  const identity = await tx.invitation.findUnique({ where: { slug: intent.slug }, select: { organizationId: true, eventId: true, id: true } });
  if (!identity) throw new NotFoundException('No such invitation');
  await tx.$queryRaw`SELECT id FROM organizations WHERE id=${identity.organizationId} FOR SHARE`;
  const selected = await selectAvailableTemplate(tx, { organizationId: identity.organizationId, templateVersionId: intent.targetVersionId });
  if (!selected) throw new NotFoundException('TEMPLATE_NOT_FOUND');
  const target = await tx.designTemplateVersion.findUniqueOrThrow({ where: { id: selected.templateVersionId } });
  if (Array.isArray(target.assetManifest) && target.assetManifest.length) throw new ConflictException({ code: 'TEMPLATE_ASSET_NOT_READY', message: 'Private artwork materialization is required before adoption' });
  await tx.$queryRaw`SELECT id FROM events WHERE id=${identity.eventId} FOR UPDATE`;
  const event = await tx.event.findUniqueOrThrow({ where: { id: identity.eventId }, select: { status: true } });
  if (event.status === 'ARCHIVED') throw new ConflictException('Archived events cannot change design');
  await tx.$queryRaw`SELECT id FROM invitations WHERE id=${identity.id} FOR UPDATE`;
  await requireDesigner(tx, { userId: intent.userId, eventId: identity.eventId, organizationId: identity.organizationId });
  const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: identity.id }, include: adoptionInclude });
  return { invitation, target: { ...target, key: selected.key } };
}
async function requireDesigner(tx: Prisma.TransactionClient, intent: { userId: string; eventId: string; organizationId: string }) {
  await tx.$queryRaw`SELECT id FROM users WHERE id=${intent.userId} FOR SHARE`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: intent.userId }, select: { isActive: true, deletedAt: true, platformRole: true,
    eventMemberships: { where: { eventId: intent.eventId }, select: { role: true } }, organizationMemberships: { where: { organizationId: intent.organizationId }, select: { role: true } } } });
  const actor = { userId: intent.userId, email: '', platformRole: user.platformRole, eventRole: user.eventMemberships[0]?.role, organizationRole: user.organizationMemberships[0]?.role } satisfies RequestActor;
  if (!user.isActive || user.deletedAt || !actorCan(actor, 'invitation:design')) throw new NotFoundException('No such invitation');
}
async function loadSource(tx: Prisma.TransactionClient, invitation: AdoptionInvitation) {
  const assets = await tx.mediaAsset.findMany({ where: { eventId: invitation.eventId, id: { in: invitation.blocks.flatMap((block) => block.assetIds) } }, select: blockMediaSelect });
  const media = new Map(assets.map((asset) => [asset.id, asset]));
  const payload = buildInvitationContent({ ...invitation, template: pinnedTemplate(invitation), media });
  const hash = hashTemplateContent({ templateVersionId: invitation.templateVersionId, theme: invitation.theme, rsvpFields: invitation.rsvpFields,
    blocks: invitation.blocks, questions: invitation.questions, payload: { ...payload, isAcceptingResponses: undefined }, assets });
  return { hash, media };
}
function assertDesignRevision(actual: bigint, expected: string) {
  if (String(actual) !== expected) throw new ConflictException({ code: 'TEMPLATE_PREVIEW_STALE', message: 'Design changed; generate a fresh preview' });
}
async function requireUpgradePreview(tx: Prisma.TransactionClient, intent: { invitation: AdoptionInvitation; userId: string; sourceHash: string; target: { id: string; contentHash: string }; previewId: string }) {
  const preview = await tx.templatePreview.findUnique({ where: { id: intent.previewId } });
  if (!preview || preview.actorUserId !== intent.userId || preview.invitationId !== intent.invitation.id || preview.expiresAt <= new Date()
    || preview.sourceHash !== intent.sourceHash || preview.sourceVersionId !== intent.invitation.templateVersionId
    || preview.targetVersionId !== intent.target.id || preview.targetHash !== intent.target.contentHash) throw new ConflictException('TEMPLATE_PREVIEW_STALE');
}
