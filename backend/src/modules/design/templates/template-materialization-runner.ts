import { Injectable } from '@nestjs/common';
import { InvitationTemplateAsset, Prisma, TemplateMaterialization } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrivateStorageService } from '../../../infra/storage/private/private-storage';
import { lockOrganizationStanding, requireCurrentEventPermission } from '../../../infra/auth/access-locks';
@Injectable()
export class TemplateMaterializationRunner {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService) {}
  async runOne(): Promise<boolean> {
    const copy = await this.claim(); if (!copy) return false;
    const heartbeat = setInterval(() => { void this.prisma.invitationTemplateAsset.updateMany({ where: { id: copy.id, leaseOwner: copy.leaseOwner, leaseGeneration: copy.leaseGeneration, state: 'PROCESSING' }, data: { leaseUntil: new Date(Date.now() + 30000) } }).catch(() => undefined); }, 10000);
    try {
      const source = await this.prisma.designTemplateAsset.findUniqueOrThrow({ where: { id: copy.sourceAssetId } });
      if (source.state !== 'AVAILABLE' || !source.sanitizedKey || source.contentHash !== copy.contentHash) throw new Error('unavailable');
      const buffer = await this.storage.get(source.sanitizedKey);
      if (createHash('sha256').update(buffer).digest('hex') !== copy.contentHash) throw new Error('checksum');
      await this.putCopy(copy, buffer);
      await this.finalize(copy, buffer.length);
    } catch {
      await this.fail(copy);
    } finally { clearInterval(heartbeat); }
    return true;
  }
  private fail(copy: InvitationTemplateAsset) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM template_materializations WHERE id=${copy.materializationId} FOR UPDATE`;
      const preparation = await tx.templateMaterialization.findUnique({ where: { id: copy.materializationId } });
      if (preparation?.state !== 'PROCESSING') return;
      const failed = await tx.invitationTemplateAsset.updateMany({ where: { id: copy.id, state: 'PROCESSING', leaseOwner: copy.leaseOwner, leaseGeneration: copy.leaseGeneration },
        data: { state: 'RETIRED', leaseOwner: null, leaseUntil: null } });
      if (!failed.count) return;
      await tx.templateMaterialization.update({ where: { id: preparation.id }, data: { state: 'FAILED' } });
      await tx.invitationTemplateAsset.updateMany({ where: { materializationId: preparation.id, state: { in: ['PROCESSING', 'AVAILABLE'] } }, data: { state: 'RETIRED' } });
      await tx.designTemplateStoredObject.updateMany({ where: { materializationId: preparation.id, state: { not: 'DELETED' } }, data: { state: 'RETIRED', cleanupAfter: new Date() } });
    });
  }
  private async putCopy(copy: InvitationTemplateAsset, buffer: Buffer) {
    try { await this.storage.put(copy.objectKey, buffer, copy.mimeType); }
    catch (error) {
      const existing = await this.storage.get(copy.objectKey).catch(() => null);
      if (!existing || createHash('sha256').update(existing).digest('hex') !== copy.contentHash) throw error;
    }
  }
  private claim() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<InvitationTemplateAsset[]>`SELECT a.* FROM invitation_template_assets a JOIN template_materializations m ON m.id=a."materializationId"
        WHERE a.state='PROCESSING' AND a.attempts<3 AND (a."leaseUntil" IS NULL OR a."leaseUntil"<now()) AND m.state='PROCESSING' AND m."expiresAt">now()
        ORDER BY a."createdAt" FOR UPDATE OF a SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      return tx.invitationTemplateAsset.update({ where: { id: rows[0].id }, data: { leaseOwner: randomUUID(), leaseUntil: new Date(Date.now() + 30000), leaseGeneration: { increment: 1 }, attempts: { increment: 1 } } });
    });
  }
  private finalize(copy: InvitationTemplateAsset, sizeBytes: number) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId: copy.organizationId });
      await tx.$queryRaw`SELECT id FROM design_templates WHERE id=${copy.templateId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM events WHERE id=${copy.eventId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM invitations WHERE id=${copy.invitationId} FOR SHARE`;
      const requester = await tx.templateMaterialization.findUniqueOrThrow({ where: { id: copy.materializationId }, select: { actorUserId: true } });
      await requireCurrentEventPermission(tx, { actor: { userId: requester.actorUserId }, eventId: copy.eventId, permission: 'invitation:design' });
      await tx.$queryRaw`SELECT id FROM template_materializations WHERE id=${copy.materializationId} FOR UPDATE`;
      const materialization = await tx.templateMaterialization.findUniqueOrThrow({ where: { id: copy.materializationId } });
      await tx.$queryRaw`SELECT id FROM invitation_template_assets WHERE id=${copy.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT key FROM design_template_stored_objects WHERE key=${copy.objectKey} FOR UPDATE`;
      const current = await tx.invitationTemplateAsset.findUniqueOrThrow({ where: { id: copy.id } });
      const object = await tx.designTemplateStoredObject.findUniqueOrThrow({ where: { key: copy.objectKey } });
      if (current.state !== 'PROCESSING' || current.leaseOwner !== copy.leaseOwner || current.leaseGeneration !== copy.leaseGeneration || !current.leaseUntil || current.leaseUntil <= new Date() || object.state !== 'RESERVED') return;
      if (materialization.expiresAt <= new Date() || materialization.state !== 'PROCESSING') return;
      await tx.invitationTemplateAsset.update({ where: { id: copy.id }, data: { state: 'AVAILABLE', leaseOwner: null, leaseUntil: null } });
      await tx.designTemplateStoredObject.update({ where: { key: copy.objectKey }, data: { state: 'AVAILABLE', contentHash: copy.contentHash, sizeBytes } });
      const remaining = await tx.invitationTemplateAsset.count({ where: { materializationId: materialization.id, state: { not: 'AVAILABLE' } } });
      if (!remaining) await completeMaterialization(tx, materialization);
    });
  }
}

async function completeMaterialization(tx: Prisma.TransactionClient, materialization: TemplateMaterialization) {
  if (!materialization.isInitialSelection) {
    await tx.templateMaterialization.update({ where: { id: materialization.id }, data: { state: 'READY' } }); return;
  }
  const invitation = await tx.invitation.findUnique({ where: { id: materialization.invitationId }, select: { templateVersionId: true } });
  if (invitation?.templateVersionId !== materialization.targetVersionId) {
    await tx.templateMaterialization.update({ where: { id: materialization.id }, data: { state: 'RETIRED' } }); return;
  }
  await tx.invitationTemplateAsset.updateMany({ where: { materializationId: materialization.id, state: 'AVAILABLE' }, data: { state: 'BOUND' } });
  await tx.templateMaterialization.update({ where: { id: materialization.id }, data: { state: 'BOUND' } });
}
