import { Injectable } from '@nestjs/common';
import { GuestMedia, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateStorageService } from '../../infra/storage/private/private-storage';

@Injectable()
export class PrivateMediaRunner {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService) {}

  async runOne(): Promise<boolean> {
    const job = await this.claim(); if (!job) return false;
    let source: Buffer;
    try { source = await this.storage.get(job.sourceKey); }
    catch { await this.fail(job, 'STORAGE_UNAVAILABLE', false); return true; }
    let outputs: Awaited<ReturnType<typeof renderPrivateImage>>;
    try { outputs = await renderPrivateImage(source, job.kind); }
    catch { await this.fail(job, 'INVALID_IMAGE', true); return true; }
    try {
      await this.putIdempotently(job.displayKey!, outputs.display, outputs.mimeType);
      if (outputs.thumbnail) await this.putIdempotently(job.thumbnailKey!, outputs.thumbnail, outputs.mimeType);
      const storedBytes = job.sourceBytes + outputs.display.length + (outputs.thumbnail?.length ?? 0);
      await this.prisma.guestMedia.updateMany({ where: { id: job.id, processingStatus: 'PROCESSING', claimToken: job.claimToken,
        eventId: { not: null }, uploaderGuestId: { not: null } }, data: { processingStatus: 'READY', width: outputs.width, height: outputs.height,
        storedBytes, reservedBytes: storedBytes, leaseUntil: null, claimToken: null, failureReason: null } });
    } catch { await this.fail(job, 'STORAGE_UNAVAILABLE', false); }
    return true;
  }

  private claim() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guest_media
        WHERE ("processingStatus" = 'QUEUED' OR ("processingStatus" = 'PROCESSING' AND "leaseUntil" < now()))
          AND "eventId" IS NOT NULL AND "uploaderGuestId" IS NOT NULL
        ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      const image = await tx.guestMedia.findUniqueOrThrow({ where: { id: rows[0].id } });
      if (image.attempts >= 3) {
        await tx.guestMedia.update({ where: { id: image.id }, data: { processingStatus: 'FAILED', failureReason: 'ATTEMPTS_EXHAUSTED', leaseUntil: null } });
        return null;
      }
      return tx.guestMedia.update({ where: { id: image.id }, data: { processingStatus: 'PROCESSING', attempts: { increment: 1 }, claimToken: randomUUID(),
        leaseUntil: new Date(Date.now() + 120_000), displayKey: image.displayKey ?? randomUUID(),
        thumbnailKey: image.kind === 'GALLERY' ? image.thumbnailKey ?? randomUUID() : null } });
    });
  }
  private async fail(job: GuestMedia, reason: string, isFinal: boolean) {
    await this.prisma.guestMedia.updateMany({ where: { id: job.id, processingStatus: 'PROCESSING', claimToken: job.claimToken },
      data: { processingStatus: isFinal || job.attempts >= 3 ? 'FAILED' : 'QUEUED', failureReason: reason, claimToken: null, leaseUntil: null } });
  }
  private async putIdempotently(key: string, buffer: Buffer, type: string) {
    try { await this.storage.put(key, buffer, type); }
    catch (error) {
      // A recovered claim may finish the same immutable source twice. Its keys stay in the ledger.
      const existing = await this.storage.get(key).catch(() => null);
      if (!existing?.equals(buffer)) throw error;
    }
  }

  private async markAbandoned(now: Date) {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const where: Prisma.GuestMediaWhereInput = { processingStatus: { not: 'REMOVED' }, OR: [
      { eventId: null }, { uploaderGuestId: null }, { processingStatus: 'STAGING', leaseUntil: { lt: now } },
      { kind: 'SIGNATURE', createdAt: { lt: yesterday }, acknowledgements: { none: {} } },
      { processingStatus: 'FAILED', updatedAt: { lt: yesterday } },
    ] };
    await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.guestMedia.findMany({ where, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 100 });
      if (!candidates.length) return;
      // Skip a drawing being signed and recheck after locking: the acknowledgement
      // may have committed after candidate selection. It must retain its evidence.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guest_media WHERE id IN (${Prisma.join(candidates.map((row) => row.id))}) FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return;
      await tx.guestMedia.updateMany({ where: { ...where, id: { in: locked.map((row) => row.id) } },
        data: { processingStatus: 'REMOVED', removedAt: now, cleanupAfter: now, caption: null } });
    });
  }

  async cleanup() {
    const now = new Date();
    await this.markAbandoned(now);
    const removed = await this.prisma.guestMedia.findMany({ where: { processingStatus: 'REMOVED', cleanupAfter: { lte: now } },
      orderBy: { cleanupAfter: 'asc' }, take: 100, select: { id: true, sourceKey: true, displayKey: true, thumbnailKey: true } });
    // Bounded maintenance batch. Repeat tombstones reclaim arbitrarily late writes from dead claims.
    for (const row of removed) {
      const keys = [row.sourceKey, row.displayKey, row.thumbnailKey].filter((key): key is string => key !== null);
      await Promise.all(keys.map((key) => this.storage.remove(key)));
      await this.prisma.guestMedia.update({ where: { id: row.id }, data: { clearedAt: now, reservedBytes: 0, storedBytes: 0,
        cleanupAfter: new Date(now.getTime() + 3_600_000), uploaderGuestId: null, caption: null, moderatedBy: null } });
    }
    return { cleared: removed.length };
  }
}

export async function renderPrivateImage(source: Buffer, kind: 'GALLERY' | 'SIGNATURE') {
  assertRasterBytes(source);
  const maxPixels = kind === 'SIGNATURE' ? 4_000_000 : 40_000_000;
  const pipeline = sharp(source, { limitInputPixels: maxPixels, animated: false, failOn: 'warning' }).rotate();
  const metadata = await pipeline.metadata();
  if ((metadata.pages ?? 1) !== 1) throw new Error('Animated images are not accepted');
  const resized = pipeline.resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
  const display = kind === 'SIGNATURE' ? await resized.png().toBuffer({ resolveWithObject: true }) : await resized.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  const maxDisplay = kind === 'SIGNATURE' ? 1024 * 1024 : 2 * 1024 * 1024;
  if (display.data.length > maxDisplay) throw new Error('Processed image is too large');
  const thumbnail = await makeThumbnail(display.data, kind);
  return { display: display.data, thumbnail, width: display.info.width, height: display.info.height, mimeType: kind === 'SIGNATURE' ? 'image/png' : 'image/webp' };
}

function assertRasterBytes(source: Buffer): void {
  const isPng = source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = source[0] === 255 && source[1] === 216 && source[2] === 255;
  const isWebp = source.toString('ascii', 0, 4) === 'RIFF' && source.toString('ascii', 8, 12) === 'WEBP';
  const isAvif = source.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(source.toString('ascii', 8, 64));
  if (isPng && hasPngAnimation(source)) throw new Error('Animated images are not accepted');
  if (![isPng, isJpeg, isWebp, isAvif].some(Boolean)) throw new Error('Only raster image bytes are accepted');
}
async function makeThumbnail(display: Buffer, kind: 'SIGNATURE' | 'GALLERY') {
  if (kind !== 'GALLERY') return null;
  const thumbnail = await sharp(display).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  if (thumbnail.length > 512 * 1024) throw new Error('Thumbnail is too large');
  return thumbnail;
}

function hasPngAnimation(source: Buffer): boolean {
  let offset = 8;
  while (offset + 8 <= source.length) {
    const size = source.readUInt32BE(offset);
    if (source.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += size + 12;
  }
  return false;
}
