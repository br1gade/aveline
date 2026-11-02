import { retryTemplateTransaction } from './template-transaction';
import { hashDraftSnapshot, lockDraftArtwork, readDraftArtwork } from './template-artwork';
import { DomainHttpException } from '../../../common/domain-http.exception';
import { TemplateCapabilitiesService } from './capabilities/template-capabilities.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { BlockType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { lockOrganizationStanding } from '../../../infra/auth/access-locks';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildInvitationContent } from '../../invitations/invitation-content';
import { syntheticPreview } from '../synthetic-preview';
import { hashTemplateContent } from './template-content';
import { assertTemplateAuthor } from './template-policy';
import { TemplateGatesService } from './template-gates.service';
import { CreateTemplateDto, PatchTemplateDraftDto, PublishTemplateDto, TemplateAssignmentDto } from './template.dto';
import { definitionJson, isRecord, TemplateDefinition, validateTemplateDefinition } from './template-validation';

@Injectable()
export class TemplateAuthoringService {
  constructor(private readonly prisma: PrismaService, private readonly gates: TemplateGatesService, private readonly capabilities: TemplateCapabilitiesService) {}

  async list(userId: string, cursor?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR SHARE`;
      const user = await tx.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null, platformRole: { in: ['ADMIN', 'SUPPORT'] } }, select: { platformRole: true } });
      if (!user) throw new DomainHttpException('TEMPLATE_ACTION_FORBIDDEN', 'Active platform staff required');
      const rows = await tx.$queryRaw<{ id: string; key: string; ownerScopeKey: string; revision: number; isActive: boolean }[]>`SELECT t.id,t.key,t."ownerScopeKey",t.revision,t."isActive"
        FROM design_templates t LEFT JOIN organizations o ON o.id=t."organizationId"
        WHERE (t."organizationId" IS NULL OR o."deletedAt" IS NULL) AND (${cursor ?? null}::text IS NULL OR t.id>${cursor ?? null})
        AND (${user.platformRole === 'ADMIN'} OR EXISTS (SELECT 1 FROM template_assignments a WHERE a."templateId"=t.id AND a."userId"=${userId} AND a."revokedAt" IS NULL))
        ORDER BY t.id LIMIT 51`;
      return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }

  async create(userId: string, dto: CreateTemplateDto) {
    this.gates.require('AUTHORING');
    const definition = requireDefinition(dto.definition);
    if (!dto.organizationId && (!dto.key || !/^[a-z][a-z0-9-]{0,63}$/.test(dto.key))) throw new BadRequestException('key: shared templates require a bounded lowercase key');
    if (dto.organizationId && dto.key) throw new BadRequestException('key: private template keys are generated');
    return this.prisma.$transaction(async (tx) => {
      if (dto.organizationId) await lockTemplateOrganization(tx, dto.organizationId);
      await assertTemplateAuthor(tx, { userId, templateId: '', isAdminOnly: true });
      const ownerScopeKey = dto.organizationId ? `org:${dto.organizationId}` : 'shared';
      const template = await tx.designTemplate.create({ data: { key: dto.key ?? `private-${randomUUID()}`, name: definition.name,
        organizationId: dto.organizationId, ownerScopeKey, isActive: false, isLegacyBootstrap: false, nextVersionNumber: 1 } });
      const draft = await tx.templateDraft.create({ data: { templateId: template.id, ownerScopeKey, definition: definitionJson(definition), contentHash: hashTemplateContent({ definition, artwork: [] }), createdByUserId: userId } });
      await recordAudit(tx, { templateId: template.id, userId, action: 'CREATE', revision: template.revision });
      return { templateId: template.id, key: template.key, scope: ownerScopeKey, revision: template.revision, draft };
    });
  }

  async read(userId: string, templateId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, templateId);
      await assertTemplateAuthor(tx, { userId, templateId });
      const detail = await tx.designTemplate.findUniqueOrThrow({ where: { id: templateId }, select: {
        id: true, key: true, organizationId: true, ownerScopeKey: true, revision: true, isActive: true, retiredAt: true,
        versions: { orderBy: { versionNumber: 'desc' }, take: 100 },
        drafts: { where: { state: 'OPEN' }, take: 1 }, assignments: { where: { revokedAt: null }, select: { userId: true } },
      } });
      const assets = await tx.designTemplateAsset.findMany({ where: { templateId, state: { not: 'RETIRED' } }, take: 20, orderBy: { createdAt: 'asc' },
        select: { id: true, draftId: true, state: true, kind: true, width: true, height: true, mimeType: true, contentHash: true } });
      return { ...detail, assets };
    });
  }

  async openDraft(userId: string, templateId: string, expectedRevision: number) {
    this.gates.require('AUTHORING');
    return this.prisma.$transaction(async (tx) => {
      const template = await lockAuthorTemplate(tx, templateId);
      await assertTemplateAuthor(tx, { userId, templateId });
      assertRevision(template.revision, expectedRevision);
      if (await tx.templateDraft.findFirst({ where: { templateId, state: 'OPEN' } })) throw new DomainHttpException('TEMPLATE_OPEN_DRAFT_EXISTS', 'An open draft already exists');
      const version = await tx.designTemplateVersion.findUniqueOrThrow({ where: { id: template.activeVersionId! } });
      const definition = { name: version.name, allowedFonts: version.allowedFonts, palettes: version.palettes, supportedBlocks: version.supportedBlocks, blockVariants: version.blockVariants, defaultTheme: version.defaultTheme, rendererKey: 'invitation-v1' };
      const draft = await tx.templateDraft.create({ data: { templateId, ownerScopeKey: template.ownerScopeKey, createdByUserId: userId, definition, contentHash: hashTemplateContent({ definition, artwork: [] }) } });
      await tx.designTemplate.update({ where: { id: templateId }, data: { revision: { increment: 1 } } });
      await recordAudit(tx, { templateId, userId, action: 'OPEN_DRAFT', revision: template.revision + 1 });
      return draft;
    });
  }

  async patch(userId: string, intent: { templateId: string; draftId: string; dto: PatchTemplateDraftDto }) {
    this.gates.require('AUTHORING');
    return this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, intent.templateId);
      const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: intent.templateId });
      assertRevision(draft.revision, intent.dto.expectedRevision);
      const definition = requireDefinition({ ...(isRecord(draft.definition) ? draft.definition : {}), ...intent.dto.definition });
      const updated = await tx.templateDraft.update({ where: { id: draft.id }, data: { definition: definitionJson(definition), contentHash: await hashDraftSnapshot(tx, draft.id, definition), revision: { increment: 1 } } });
      await recordAudit(tx, { templateId: intent.templateId, userId, action: 'EDIT_DRAFT', revision: updated.revision });
      return updated;
    });
  }

  async discard(userId: string, intent: { templateId: string; draftId: string; expectedRevision: number }) {
    this.gates.require('AUTHORING');
    return this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, intent.templateId); const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: intent.templateId }); assertRevision(draft.revision, intent.expectedRevision);
      await tx.designTemplateAssetReference.deleteMany({ where: { draftId: draft.id } });
      await tx.$executeRaw`UPDATE design_template_assets a SET state='RETIRED',"leaseOwner"=NULL,"leaseUntil"=NULL,"leaseGeneration"="leaseGeneration"+1
        WHERE a."draftId"=${draft.id} AND NOT EXISTS (SELECT 1 FROM design_template_asset_references r WHERE r."assetId"=a.id)`;
      await tx.$executeRaw`UPDATE design_template_stored_objects SET state='RETIRED',"cleanupAfter"=now()
        WHERE "assetId" IN (SELECT id FROM design_template_assets WHERE "draftId"=${draft.id} AND state='RETIRED')`;
      const result = await tx.templateDraft.update({ where: { id: draft.id }, data: { state: 'DISCARDED', revision: { increment: 1 } } });
      await recordAudit(tx, { templateId: intent.templateId, userId, action: 'DISCARD_DRAFT', revision: result.revision });
      return result;
    });
  }

  async validate(userId: string, intent: { templateId: string; draftId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, intent.templateId);
      const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: intent.templateId });
      return { draftId: draft.id, revision: draft.revision, contentHash: draft.contentHash,
        errors: validateTemplateDefinition(draft.definition), ...this.publicationStatus(draft.definition) };
    });
  }

  async preview(userId: string, intent: { templateId: string; draftId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const template = await lockAuthorTemplate(tx, intent.templateId);
      const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: intent.templateId });
      const definition = requireDefinition(draft.definition);
      const preview = await tx.templatePreview.create({ data: { templateId: template.id, draftId: draft.id, actorUserId: userId,
        sourceHash: draft.contentHash, targetHash: draft.contentHash, draftRevision: draft.revision, capabilityDigest: this.capabilities.match(definition)?.digest, expiresAt: new Date(Date.now() + 900000) } });
      const synthetic = syntheticPreview({ ...definition, id: template.id, key: template.key, defaultTheme: definition.defaultTheme as Prisma.JsonObject });
      const artwork = await readDraftArtwork(tx, draft.id);
      synthetic.defaultMedia = new Map();
      for (const asset of artwork) {
        const type = asset.slot as BlockType;
        synthetic.defaultMedia.set(type, [...(synthetic.defaultMedia.get(type) ?? []), { id: asset.assetId, url: `/api/v1/design-templates/${template.id}/assets/${asset.assetId}/file`,
          kind: asset.kind as 'PHOTO' | 'COVER', width: asset.width, height: asset.height, altText: {}, variants: [] }]);
      }
      const payloads = Object.fromEntries(['en', 'ru', 'fr', 'hy'].map((locale) => [locale, { ...buildInvitationContent(synthetic, locale), isPreview: true, isAcceptingResponses: false }]));
      return { previewId: preview.id, revision: draft.revision, contentHash: draft.contentHash, expiresAt: preview.expiresAt,
        previewSource: 'SYNTHETIC', ...this.publicationStatus(draft.definition), payloads };
    });
  }

  async publish(userId: string, intent: { templateId: string; draftId: string; dto: PublishTemplateDto }) {
    const requestHash = hashTemplateContent(intent);
    return retryTemplateTransaction(() => this.prisma.$transaction(async (tx) => {
      const template = await lockAuthorTemplate(tx, intent.templateId);
      const prior = await tx.templateReceipt.findUnique({ where: { scopeKey_idempotencyKey: { scopeKey: template.id, idempotencyKey: intent.dto.idempotencyKey } } });
      if (prior) {
        await assertTemplateAuthor(tx, { userId, templateId: template.id, isAdminOnly: true });
        return replayReceipt(prior, { userId, requestHash });
      }
      const draft = await requireOpenDraft(tx, intent);
      await assertTemplateAuthor(tx, { userId, templateId: template.id, isAdminOnly: true });
      assertRevision(draft.revision, intent.dto.expectedRevision);
      const definition = requireDefinition(draft.definition);
      if (draft.contentHash !== await hashDraftSnapshot(tx, draft.id, definition)) throw new DomainHttpException('TEMPLATE_PREVIEW_STALE', 'Draft content hash changed outside the authoring transaction');
      const capability = this.capabilities.require(definition);
      this.gates.require('PUBLISH');
      await requireAcceptedPreview(tx, { userId, draft, dto: intent.dto, capabilityDigest: capability.digest });
      const artwork = await lockDraftArtwork(tx, draft.id);
      if (artwork.length) this.gates.require('ASSETS');
      if (artwork.some((asset) => !capability.mediaSlots.includes(asset.slot))) throw new DomainHttpException('TEMPLATE_VALIDATION_FAILED', 'assets: renderer capability does not declare this slot');
      const version = await tx.designTemplateVersion.create({ data: {
        templateId: template.id, ownerScopeKey: template.ownerScopeKey, versionNumber: template.nextVersionNumber,
        name: definition.name, allowedFonts: definition.allowedFonts, palettes: definition.palettes,
        supportedBlocks: definition.supportedBlocks, blockVariants: definition.blockVariants,
        defaultTheme: definition.defaultTheme as Prisma.InputJsonValue, contentHash: draft.contentHash,
        rendererKey: capability.rendererKey, capabilityVersion: capability.capabilityVersion, capabilityDigest: capability.digest,
        assetManifest: artwork as unknown as Prisma.InputJsonValue, rendererManifest: capability as unknown as Prisma.InputJsonValue,
        provenance: 'AUTHORED', publishedAt: new Date(), publishedByUserId: userId, sourceDraftId: draft.id, sourceDraftRevision: draft.revision,
      } });
      if (artwork.length) await tx.designTemplateAssetReference.createMany({ data: artwork.map((asset) => ({ templateId: template.id, ownerScopeKey: template.ownerScopeKey, versionId: version.id, assetId: asset.assetId, slot: asset.slot, position: asset.position })) });
      await tx.designTemplate.update({ where: { id: template.id }, data: { activeVersionId: version.id, isActive: true, retiredAt: null, nextVersionNumber: { increment: 1 }, revision: { increment: 1 } } });
      await tx.templateDraft.update({ where: { id: draft.id }, data: { state: 'PUBLISHED' } });
      const result = { templateId: template.id, versionId: version.id, versionNumber: version.versionNumber, contentHash: version.contentHash };
      await tx.templateReceipt.create({ data: { scopeKey: template.id, idempotencyKey: intent.dto.idempotencyKey, actorUserId: userId, requestHash, result } });
      await recordAudit(tx, { templateId: template.id, userId, action: 'PUBLISH', revision: template.revision + 1 });
      return result;
    }));
  }

  async retire(userId: string, templateId: string, expectedRevision: number) {
    return this.prisma.$transaction(async (tx) => {
      const template = await lockAuthorTemplate(tx, templateId);
      await assertTemplateAuthor(tx, { userId, templateId, isAdminOnly: true });
      assertRevision(template.revision, expectedRevision);
      const result = await tx.designTemplate.update({ where: { id: templateId }, data: { isActive: false, retiredAt: new Date(), revision: { increment: 1 } }, select: { id: true, revision: true, retiredAt: true } });
      await recordAudit(tx, { templateId, userId, action: 'RETIRE', revision: result.revision });
      return result;
    });
  }

  private publicationStatus(definition: unknown) {
    if (validateTemplateDefinition(definition).length) return this.gates.publicationStatus();
    const capability = this.capabilities.match(definition as TemplateDefinition);
    return capability ? { canPublish: this.gates.canPublish(), rendererAcceptance: 'TESTED_CAPABILITY', capabilityDigest: capability.digest } : this.gates.publicationStatus();
  }

  async assign(userId: string, templateId: string, dto: TemplateAssignmentDto, isRevoke = false) {
    return this.prisma.$transaction(async (tx) => {
      const template = await lockAuthorTemplate(tx, templateId);
      await assertTemplateAuthor(tx, { userId, templateId, isAdminOnly: true });
      assertRevision(template.revision, dto.expectedRevision);
      await tx.$queryRaw`SELECT id FROM users WHERE id=${dto.userId} FOR SHARE`;
      const target = await tx.user.findFirst({ where: { id: dto.userId, platformRole: 'SUPPORT', isActive: true, deletedAt: null } });
      if (!target && !isRevoke) throw new BadRequestException('userId: assignment requires active SUPPORT');
      const assignment = await tx.templateAssignment.upsert({ where: { templateId_userId: { templateId, userId: dto.userId } },
        create: { templateId, userId: dto.userId, assignedByUserId: userId, revokedAt: isRevoke ? new Date() : null },
        update: { revokedAt: isRevoke ? new Date() : null, assignedByUserId: userId } });
      await tx.designTemplate.update({ where: { id: templateId }, data: { revision: { increment: 1 } } });
      await recordAudit(tx, { templateId, userId, action: isRevoke ? 'REVOKE' : 'ASSIGN', revision: template.revision + 1 });
      return assignment;
    });
  }
}

export async function lockTemplateOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  await lockOrganizationStanding(tx, { organizationId });
}
export async function lockAuthorTemplate(tx: Prisma.TransactionClient, templateId: string) {
  const identity = await tx.designTemplate.findUnique({ where: { id: templateId }, select: { organizationId: true } });
  if (!identity) throw new DomainHttpException('TEMPLATE_NOT_FOUND', 'No such template');
  if (identity.organizationId) await lockTemplateOrganization(tx, identity.organizationId);
  await tx.$queryRaw`SELECT id FROM design_templates WHERE id=${templateId} FOR UPDATE`;
  return tx.designTemplate.findUniqueOrThrow({ where: { id: templateId } });
}
export async function requireTemplateDraft(tx: Prisma.TransactionClient, intent: { templateId: string; draftId: string }) {
  await tx.$queryRaw`SELECT id FROM template_drafts WHERE id=${intent.draftId} AND "templateId"=${intent.templateId} FOR UPDATE`;
  const draft = await tx.templateDraft.findFirst({ where: { id: intent.draftId, templateId: intent.templateId } });
  if (!draft) throw new DomainHttpException('TEMPLATE_DRAFT_NOT_FOUND', 'No such draft on this template');
  return draft;
}
export async function requireOpenDraft(tx: Prisma.TransactionClient, intent: { templateId: string; draftId: string }) {
  const draft = await requireTemplateDraft(tx, intent);
  if (draft.state !== 'OPEN') throw new DomainHttpException('TEMPLATE_STATE_CHANGED', 'This draft is frozen');
  return draft;
}

export function assertRevision(current: number, expected: number) {
  if (current !== expected) throw new DomainHttpException('TEMPLATE_REVISION_CONFLICT', 'Reload before changing this revision');
}
function requireDefinition(input: unknown): TemplateDefinition {
  const errors = validateTemplateDefinition(input);
  if (errors.length) throw new DomainHttpException('TEMPLATE_VALIDATION_FAILED', errors.map((error) => `${error.field}: ${error.message}`));
  return input as TemplateDefinition;
}
export async function recordAudit(tx: Prisma.TransactionClient, intent: { templateId: string; userId: string; action: string; revision: number }) {
  await tx.templateAudit.create({ data: { templateId: intent.templateId, actorUserId: intent.userId, action: intent.action, revision: intent.revision } });
}

function replayReceipt(receipt: { actorUserId: string; requestHash: string; result: Prisma.JsonValue }, intent: { userId: string; requestHash: string }) {
  if (receipt.actorUserId !== intent.userId || receipt.requestHash !== intent.requestHash) throw new DomainHttpException('TEMPLATE_IDEMPOTENCY_CONFLICT', 'Idempotency key belongs to a different request');
  return receipt.result;
}
async function requireAcceptedPreview(tx: Prisma.TransactionClient, intent: { userId: string; draft: { id: string; revision: number; contentHash: string }; dto: PublishTemplateDto; capabilityDigest: string }) {
  const preview = await tx.templatePreview.findUnique({ where: { id: intent.dto.previewId } });
  if (!preview || preview.draftId !== intent.draft.id || preview.actorUserId !== intent.userId || preview.expiresAt <= new Date()
    || preview.draftRevision !== intent.draft.revision || preview.capabilityDigest !== intent.capabilityDigest || preview.targetHash !== intent.draft.contentHash || intent.dto.contentHash !== intent.draft.contentHash) {
    throw new DomainHttpException('TEMPLATE_PREVIEW_STALE', 'Preview this exact draft again before publication');
  }
}
