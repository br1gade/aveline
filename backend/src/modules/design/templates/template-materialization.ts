import { BlockType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainHttpException } from '../../../common/domain-http.exception';
import { ContentMedia } from '../../invitations/invitation-content';
import { TemplateArtwork } from './template-artwork';
export async function prepareTemplateMaterialization(tx: Prisma.TransactionClient, intent: { previewId: string; actorUserId: string; invitation: { id: string; eventId: string; organizationId: string }; target: { id: string; templateId: string; ownerScopeKey: string; assetManifest: Prisma.JsonValue }; sourceHash: string; expiresAt: Date }) {
  const artwork = intent.target.assetManifest as unknown as TemplateArtwork[];
  if (!Array.isArray(artwork) || !artwork.length) return null;
  const materialization = await tx.templateMaterialization.create({ data: { previewId: intent.previewId, actorUserId: intent.actorUserId,
    invitationId: intent.invitation.id, eventId: intent.invitation.eventId, organizationId: intent.invitation.organizationId,
    targetVersionId: intent.target.id, sourceHash: intent.sourceHash, expiresAt: intent.expiresAt } });
  const copies = artwork.map((asset) => ({ ...asset, id: randomUUID(), objectKey: randomUUID() }));
  await tx.invitationTemplateAsset.createMany({ data: copies.map((asset) => ({ id: asset.id, objectKey: asset.objectKey, sourceAssetId: asset.assetId,
    materializationId: materialization.id, invitationId: intent.invitation.id, eventId: intent.invitation.eventId, organizationId: intent.invitation.organizationId,
    templateVersionId: intent.target.id, templateId: intent.target.templateId, ownerScopeKey: intent.target.ownerScopeKey,
    slot: asset.slot, position: asset.position, kind: asset.kind, width: asset.width, height: asset.height, mimeType: asset.mimeType, contentHash: asset.contentHash })) });
  await tx.designTemplateStoredObject.createMany({ data: copies.map((asset) => ({ key: asset.objectKey, templateId: intent.target.templateId,
    materializationId: materialization.id, purpose: 'EVENT_COPY', cleanupAfter: intent.expiresAt })) });
  return materialization;
}
export async function bindTemplateMaterialization(tx: Prisma.TransactionClient, intent: { previewId: string; invitationId: string; targetVersionId: string; hasArtwork: boolean }) {
  const materialization = await tx.templateMaterialization.findUnique({ where: { previewId: intent.previewId } });
  if (intent.hasArtwork && (!materialization || materialization.state !== 'READY' || materialization.expiresAt <= new Date())) throw new DomainHttpException('TEMPLATE_ASSET_NOT_READY', 'Event artwork is not prepared');
  const previous = await tx.invitationTemplateAsset.findMany({ where: { invitationId: intent.invitationId, state: 'BOUND' }, select: { objectKey: true } });
  await tx.invitationTemplateAsset.updateMany({ where: { invitationId: intent.invitationId, state: 'BOUND' }, data: { state: 'RETIRED' } });
  if (previous.length) await tx.designTemplateStoredObject.updateMany({ where: { key: { in: previous.map((asset) => asset.objectKey) } }, data: { state: 'RETIRED', cleanupAfter: new Date() } });
  if (!materialization) return;
  await tx.$queryRaw`SELECT id FROM invitation_template_assets WHERE "materializationId"=${materialization.id} ORDER BY id FOR UPDATE`;
  await tx.invitationTemplateAsset.updateMany({ where: { materializationId: materialization.id, state: 'AVAILABLE' }, data: { state: 'BOUND' } });
  await tx.templateMaterialization.update({ where: { id: materialization.id }, data: { state: 'BOUND' } });
}
export async function readTemplateDefaultMedia(tx: Prisma.TransactionClient, intent: { invitationId?: string; versionId: string; materializationId?: string }) {
  const bindings = await tx.invitationTemplateAsset.findMany({ where: { templateVersionId: intent.versionId,
    ...(intent.materializationId ? { materializationId: intent.materializationId, state: 'AVAILABLE' } : { invitationId: intent.invitationId, state: 'BOUND' }) },
    select: { id: true, slot: true, kind: true, width: true, height: true, mimeType: true, contentHash: true }, orderBy: [{ slot: 'asc' }, { position: 'asc' }], take: 20 });
  const media = new Map<BlockType, ContentMedia[]>();
  for (const asset of bindings) {
    const block = asset.slot as BlockType;
    const item: ContentMedia = { id: asset.id, url: `template-asset:${asset.id}`, kind: asset.kind as 'PHOTO' | 'COVER', width: asset.width, height: asset.height, altText: {}, variants: [] };
    media.set(block, [...(media.get(block) ?? []), item]);
  }
  return { media, bindings };
}

/** Initial selection creates only durable jobs; event creation/conversion rollback leaves no object writes. */
export async function reserveInitialTemplateArtwork(tx: Prisma.TransactionClient, intent: { userId: string; invitation: { id: string; eventId: string; organizationId: string; templateVersionId: string } }) {
  const target = await tx.designTemplateVersion.findUniqueOrThrow({ where: { id: intent.invitation.templateVersionId } });
  if (!Array.isArray(target.assetManifest) || !target.assetManifest.length) return { state: 'READY' };
  const sourceHash = `initial:${intent.invitation.id}:${target.contentHash}`;
  const preview = await tx.templatePreview.create({ data: { templateId: target.templateId, invitationId: intent.invitation.id, actorUserId: intent.userId,
    sourceVersionId: target.id, targetVersionId: target.id, sourceHash, targetHash: target.contentHash, expiresAt: new Date(Date.now() + 900000) } });
  const preparation = await prepareTemplateMaterialization(tx, { previewId: preview.id, actorUserId: intent.userId, invitation: intent.invitation, target, sourceHash, expiresAt: preview.expiresAt });
  await tx.templateMaterialization.update({ where: { id: preparation!.id }, data: { isInitialSelection: true } });
  return { state: 'PROCESSING', materializationId: preparation!.id };
}
export async function assertTemplateArtworkReady(tx: Prisma.TransactionClient, invitationId: string) {
  const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: invitationId }, include: { templateVersion: { select: { assetManifest: true } } } });
  const required = Array.isArray(invitation.templateVersion.assetManifest) ? invitation.templateVersion.assetManifest.length : 0;
  const ready = await tx.invitationTemplateAsset.count({ where: { invitationId, templateVersionId: invitation.templateVersionId, state: 'BOUND' } });
  if (required !== ready) throw new DomainHttpException('TEMPLATE_ASSET_NOT_READY', 'Private design artwork must finish preparation before publication');
}
