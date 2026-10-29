import { Prisma } from '@prisma/client';
import { TemplateCapabilitiesService } from './capabilities/template-capabilities.service';
import { hashDraftSnapshot } from './template-artwork';
import { TemplateDefinition } from './template-validation';
import { DomainHttpException } from '../../../common/domain-http.exception';
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrivateStorageService } from '../../../infra/storage/private/private-storage';
import { assertRevision, lockAuthorTemplate, requireOpenDraft } from './template-authoring.service';
import { assertTemplateAuthor } from './template-policy';
import { TemplateGatesService } from './template-gates.service';
import { TEMPLATE_UPLOAD_BYTES } from './template-raster';
import { hashTemplateContent } from './template-content';

export interface TemplateAssetUpload {
  templateId: string; draftId: string; expectedRevision: number; idempotencyKey: string; kind: string;
  file: { buffer: Buffer; mimetype: string };
}
@Injectable()
export class TemplateAssetsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService, private readonly gates: TemplateGatesService, private readonly capabilities: TemplateCapabilitiesService) {}
  async upload(userId: string, intent: TemplateAssetUpload) {
    this.gates.require('ASSETS');
    assertUpload(intent);
    const requestHash = hashTemplateContent({ ...intent, file: createHash('sha256').update(intent.file.buffer).digest('hex') });
    const asset = await this.reserve(userId, intent, requestHash);
    if (asset.state !== 'PROCESSING') return { assetId: asset.id, state: asset.state };
    try {
      await this.storage.put(asset.sourceKey, intent.file.buffer, intent.file.mimetype);
    } catch (error) {
      const exists = await this.storage.get(asset.sourceKey).catch(() => null);
      if (!exists || createHash('sha256').update(exists).digest('hex') !== createHash('sha256').update(intent.file.buffer).digest('hex')) throw error;
    }
    await this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, intent.templateId);
      await assertTemplateAuthor(tx, { userId, templateId: intent.templateId });
      const current = await tx.designTemplateAsset.findUniqueOrThrow({ where: { id: asset.id } });
      if (current.state !== 'PROCESSING') throw new DomainHttpException('TEMPLATE_ASSET_NOT_READY', 'Upload was retired during storage IO');
      const finalized = await tx.designTemplateStoredObject.updateMany({ where: { key: asset.sourceKey, state: 'RESERVED' }, data: { state: 'AVAILABLE', sizeBytes: intent.file.buffer.length } });
      if (!finalized.count) throw new DomainHttpException('TEMPLATE_ASSET_NOT_READY', 'Upload reservation expired');
    });
    return { assetId: asset.id, state: asset.state };
  }
  private async reserve(userId: string, intent: TemplateAssetUpload, requestHash: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, intent.templateId);
      const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: intent.templateId });
      const scopeKey = `upload:${intent.draftId}`;
      const receipt = await tx.templateReceipt.findUnique({ where: { scopeKey_idempotencyKey: { scopeKey, idempotencyKey: intent.idempotencyKey } } });
      if (receipt) {
        if (receipt.actorUserId !== userId || receipt.requestHash !== requestHash) throw new DomainHttpException('TEMPLATE_IDEMPOTENCY_CONFLICT', 'TEMPLATE_IDEMPOTENCY_CONFLICT');
        return tx.designTemplateAsset.findUniqueOrThrow({ where: { id: String((receipt.result as { assetId: string }).assetId) } });
      }
      assertRevision(draft.revision, intent.expectedRevision);
      if (await tx.designTemplateAsset.count({ where: { draftId: draft.id, state: { not: 'RETIRED' } } }) >= 20) throw new BadRequestException('assets: at most 20 per draft');
      const asset = await tx.designTemplateAsset.create({ data: { templateId: intent.templateId, draftId: draft.id, ownerScopeKey: draft.ownerScopeKey, kind: intent.kind, sourceKey: randomUUID(), createdByUserId: userId } });
      await tx.designTemplateStoredObject.create({ data: { key: asset.sourceKey, assetId: asset.id, templateId: intent.templateId, purpose: 'SOURCE', cleanupAfter: new Date(Date.now() + 3600000) } });
      await tx.templateReceipt.create({ data: { scopeKey, idempotencyKey: intent.idempotencyKey, requestHash, actorUserId: userId, result: { assetId: asset.id } } });
      await tx.templateDraft.update({ where: { id: draft.id }, data: { revision: { increment: 1 } } });
      return asset;
    });
  }
  async read(userId: string, intent: { templateId: string; assetId: string }) {
    const asset = await this.authorizedAsset(userId, intent);
    const key = asset.sanitizedKey;
    if (asset.state !== 'AVAILABLE' || !key) throw new DomainHttpException('TEMPLATE_ASSET_NOT_READY', 'Sanitized artwork is not ready');
    const buffer = await this.storage.get(key);
    const current = await this.authorizedAsset(userId, intent);
    if (current.state !== 'AVAILABLE' || current.sanitizedKey !== key) throw new DomainHttpException('TEMPLATE_ASSET_NOT_FOUND', 'TEMPLATE_ASSET_NOT_FOUND');
    return { buffer, mimeType: current.mimeType ?? 'image/png' };
  }
  async remove(userId: string, intent: { templateId: string; assetId: string; draftId: string; expectedRevision: number }) {
    return this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, intent.templateId); const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: intent.templateId }); assertRevision(draft.revision, intent.expectedRevision);
      await tx.$queryRaw`SELECT id FROM design_template_assets WHERE id=${intent.assetId} FOR UPDATE`;
      const asset = await tx.designTemplateAsset.findFirst({ where: { id: intent.assetId, templateId: intent.templateId, draftId: draft.id } });
      if (!asset) throw new DomainHttpException('TEMPLATE_ASSET_NOT_FOUND', 'TEMPLATE_ASSET_NOT_FOUND');
      if (await tx.designTemplateAssetReference.count({ where: { assetId: asset.id } })) throw new DomainHttpException('TEMPLATE_REFERENCED', 'TEMPLATE_REFERENCED');
      await tx.designTemplateAsset.update({ where: { id: asset.id }, data: { state: 'RETIRED', leaseOwner: null, leaseUntil: null, leaseGeneration: { increment: 1 } } });
      await tx.designTemplateStoredObject.updateMany({ where: { assetId: asset.id, state: { not: 'DELETED' } }, data: { state: 'RETIRED', cleanupAfter: new Date() } });
      await tx.templateDraft.update({ where: { id: draft.id }, data: { revision: { increment: 1 } } });
      return { assetId: asset.id, state: 'RETIRED' };
    });
  }
  async attach(userId: string, intent: { templateId: string; draftId: string; expectedRevision: number; artwork: { assetId: string; slot: string }[] }) {
    this.gates.require('ASSETS');
    return this.prisma.$transaction(async (tx) => {
      const template = await lockAuthorTemplate(tx, intent.templateId); const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: template.id }); assertRevision(draft.revision, intent.expectedRevision);
      const capability = this.capabilities.require(draft.definition as unknown as TemplateDefinition);
      assertArtworkSlots(intent.artwork, capability.mediaSlots);
      const assets = intent.artwork.length ? await tx.$queryRaw<{ id: string }[]>`SELECT a.id FROM design_template_assets a JOIN design_template_stored_objects o ON o.key=a."sanitizedKey"
        WHERE a.id IN (${Prisma.join(intent.artwork.map((entry) => entry.assetId))}) AND a."templateId"=${template.id} AND a."ownerScopeKey"=${template.ownerScopeKey}
        AND a.state='AVAILABLE' AND o.state='AVAILABLE' ORDER BY a.id FOR SHARE OF a,o` : [];
      if (assets.length !== new Set(intent.artwork.map((entry) => entry.assetId)).size) throw new DomainHttpException('TEMPLATE_ASSET_NOT_READY', 'assets: same-template available sanitized artwork required');
      await tx.designTemplateAssetReference.deleteMany({ where: { draftId: draft.id } });
      const positions = new Map<string, number>();
      if (intent.artwork.length) await tx.designTemplateAssetReference.createMany({ data: intent.artwork.map((asset) => {
        const position = positions.get(asset.slot) ?? 0; positions.set(asset.slot, position + 1);
        return { ...asset, position, draftId: draft.id, templateId: template.id, ownerScopeKey: template.ownerScopeKey };
      }) });
      return tx.templateDraft.update({ where: { id: draft.id }, data: { revision: { increment: 1 }, contentHash: await hashDraftSnapshot(tx, draft.id, draft.definition) } });
    });
  }
  private authorizedAsset(userId: string, intent: { templateId: string; assetId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, intent.templateId); await assertTemplateAuthor(tx, { userId, templateId: intent.templateId });
      const asset = await tx.designTemplateAsset.findFirst({ where: { id: intent.assetId, templateId: intent.templateId } });
      if (!asset) throw new DomainHttpException('TEMPLATE_ASSET_NOT_FOUND', 'TEMPLATE_ASSET_NOT_FOUND');
      return asset;
    });
  }
}
function assertUpload(intent: TemplateAssetUpload) {
  if (!intent.file || intent.file.buffer.length > TEMPLATE_UPLOAD_BYTES) throw new BadRequestException('file: one raster file at most 5MiB');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(intent.file.mimetype)) throw new DomainHttpException('TEMPLATE_ASSET_TYPE_UNSUPPORTED', 'TEMPLATE_ASSET_TYPE_UNSUPPORTED');
  if (!['PHOTO', 'COVER'].includes(intent.kind)) throw new BadRequestException('kind: PHOTO or COVER');
}

function assertArtworkSlots(artwork: { assetId: string; slot: string }[], slots: string[]) {
  if (artwork.length > 20 || artwork.some((entry) => !slots.includes(entry.slot))) throw new DomainHttpException('TEMPLATE_VALIDATION_FAILED', 'artwork: only manifested slots are accepted, at most 20 assets');
  const keys = artwork.map((entry) => `${entry.slot}:${entry.assetId}`);
  if (new Set(keys).size !== keys.length || artwork.filter((entry) => entry.slot === 'HERO').length > 1) throw new DomainHttpException('TEMPLATE_VALIDATION_FAILED', 'artwork: duplicate assets or multiple HERO defaults');
}
