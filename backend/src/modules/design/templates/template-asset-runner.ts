import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrivateStorageService } from '../../../infra/storage/private/private-storage';
import { sanitizeTemplateRaster } from './template-raster';
import { DesignTemplateAsset } from '@prisma/client';
import { lockAuthorTemplate } from './template-authoring.service';
import { assertTemplateAuthor } from './template-policy';

@Injectable()
export class TemplateAssetRunner {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService) {}
  async runOne(): Promise<boolean> {
    const asset = await this.claim();
    if (!asset) return false;
    const heartbeat = setInterval(() => { void this.renew(asset).catch(() => undefined); }, 10000);
    try {
      const output = await sanitizeTemplateRaster(await this.storage.get(asset.sourceKey));
      await this.storage.put(asset.sanitizedKey!, output.buffer, output.mimeType);
      await this.finalize(asset, output);
    } catch {
      await this.prisma.designTemplateAsset.updateMany({ where: { id: asset.id, leaseOwner: asset.leaseOwner, leaseGeneration: asset.leaseGeneration, state: 'PROCESSING' },
        data: { state: 'FAILED', errorCode: 'TEMPLATE_ASSET_INVALID', leaseUntil: null, leaseOwner: null } });
    } finally { clearInterval(heartbeat); }
    return true;
  }
  private claim() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<DesignTemplateAsset[]>`SELECT a.* FROM design_template_assets a JOIN design_template_stored_objects o ON o.key=a."sourceKey"
        WHERE a.state='PROCESSING' AND a.attempts<3 AND (a."leaseUntil" IS NULL OR a."leaseUntil"<now()) AND o.state='AVAILABLE'
        ORDER BY a."createdAt" FOR UPDATE OF a SKIP LOCKED LIMIT 1`;
      const asset = rows[0]; if (!asset) return null;
      const key = randomUUID();
      if (asset.sanitizedKey) await tx.designTemplateStoredObject.updateMany({ where: { key: asset.sanitizedKey, state: { not: 'DELETED' } }, data: { state: 'RETIRED' } });
      await tx.designTemplateStoredObject.create({ data: { key, assetId: asset.id, templateId: asset.templateId, purpose: 'SANITIZED', cleanupAfter: new Date(Date.now() + 3600000) } });
      return tx.designTemplateAsset.update({ where: { id: asset.id }, data: { leaseOwner: randomUUID(), leaseUntil: new Date(Date.now() + 30000), leaseGeneration: { increment: 1 }, attempts: { increment: 1 }, sanitizedKey: key } });
    });
  }
  private renew(asset: DesignTemplateAsset) {
    return this.prisma.designTemplateAsset.updateMany({ where: { id: asset.id, state: 'PROCESSING', leaseOwner: asset.leaseOwner, leaseGeneration: asset.leaseGeneration }, data: { leaseUntil: new Date(Date.now() + 30000) } });
  }
  private async finalize(asset: DesignTemplateAsset, output: Awaited<ReturnType<typeof sanitizeTemplateRaster>>) {
    await this.prisma.$transaction(async (tx) => {
      await lockAuthorTemplate(tx, asset.templateId);
      await assertTemplateAuthor(tx, { userId: asset.createdByUserId, templateId: asset.templateId });
      await tx.$queryRaw`SELECT id FROM design_template_assets WHERE id=${asset.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT key FROM design_template_stored_objects WHERE key=${asset.sanitizedKey} FOR UPDATE`;
      const current = await tx.designTemplateAsset.findUniqueOrThrow({ where: { id: asset.id } });
      const object = await tx.designTemplateStoredObject.findUniqueOrThrow({ where: { key: asset.sanitizedKey! } });
      if (current.state !== 'PROCESSING' || current.leaseOwner !== asset.leaseOwner || current.leaseGeneration !== asset.leaseGeneration || object.state !== 'RESERVED' || !current.leaseUntil || current.leaseUntil <= new Date()) return;
      const contentHash = createHash('sha256').update(output.buffer).digest('hex');
      await tx.designTemplateStoredObject.update({ where: { key: object.key }, data: { state: 'AVAILABLE', contentHash, sizeBytes: output.buffer.length } });
      await tx.designTemplateAsset.update({ where: { id: asset.id }, data: { state: 'AVAILABLE', contentHash, width: output.width, height: output.height,
        sizeBytes: output.buffer.length, mimeType: output.mimeType, leaseOwner: null, leaseUntil: null } });
    });
  }
  async cleanup(): Promise<number> {
    await this.prisma.$transaction(async (tx) => {
      await tx.templateMaterialization.updateMany({ where: { state: { in: ['PROCESSING', 'READY'] }, expiresAt: { lt: new Date() } }, data: { state: 'RETIRED' } });
      await tx.$executeRaw`UPDATE design_template_stored_objects o SET state='RETIRED',"cleanupAfter"=now()
        FROM template_materializations m WHERE m.id=o."materializationId" AND m.state='RETIRED' AND o.state<>'DELETED'`;
    });
    await this.prisma.$executeRaw`WITH expired AS (SELECT id FROM design_template_assets WHERE state='PROCESSING'
      AND ("leaseUntil" IS NULL OR "leaseUntil"<now()) AND (attempts>=3 OR "createdAt"<now()-interval '1 hour')
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 50)
      UPDATE design_template_assets SET state='FAILED', "leaseOwner"=NULL,"leaseUntil"=NULL,"leaseGeneration"="leaseGeneration"+1,"errorCode"='LEASE_EXHAUSTED'
      WHERE id IN (SELECT id FROM expired)`;
    const keys = await this.retireEligible();
    await Promise.all(keys.map(async (key) => {
      await this.storage.remove(key);
      await this.prisma.designTemplateStoredObject.update({ where: { key }, data: { state: 'DELETED', deletedAt: new Date(), cleanupAfter: new Date(Date.now() + 3600000) } });
    }));
    return keys.length;
  }
  private retireEligible() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ key: string }[]>`SELECT o.key FROM design_template_stored_objects o LEFT JOIN design_template_assets a ON a.id=o."assetId" LEFT JOIN invitation_template_assets copy ON copy."objectKey"=o.key
        WHERE o."cleanupAfter"<now() AND (a."leaseUntil" IS NULL OR a."leaseUntil"<now()) AND (copy."leaseUntil" IS NULL OR copy."leaseUntil"<now())
        AND (o.purpose='SOURCE' OR NOT EXISTS (SELECT 1 FROM design_template_asset_references r WHERE r."assetId"=a.id))
        AND (o.state IN ('RETIRED','DELETED','RESERVED') OR a.state IN ('RETIRED','FAILED') OR o.purpose='SOURCE' AND a.state='AVAILABLE')
        ORDER BY o."cleanupAfter",o.key FOR UPDATE OF o SKIP LOCKED LIMIT 50`;
      const keys = rows.map((row) => row.key);
      if (keys.length) await tx.designTemplateStoredObject.updateMany({ where: { key: { in: keys } }, data: { state: 'RETIRED' } });
      return keys;
    });
  }
}
