import { Injectable, Logger } from '@nestjs/common';
import { MediaKind, Prisma } from '@prisma/client';
import sharp from 'sharp';
import { CacheService } from '../../infra/cache/cache.service';
import { StorageService, storageKeyOf } from '../../infra/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageVariant, RESIZABLE_TYPES, variantWidths } from './image-variants';

const PHOTO_KINDS: MediaKind[] = [MediaKind.PHOTO, MediaKind.COVER, MediaKind.LOGO];

/**
 * Larger than any phone's default photo (12–50 MP), small enough that one
 * decompressed image cannot take the process's memory: a 10 MB PNG can
 * declare 400 million pixels, and sharp's own limit is 268 million (B91).
 */
const MAX_INPUT_PIXELS = 60_000_000;

/** A file storage could not hand back is tried again for this long, then given up on. */
const STORAGE_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * Makes the smaller copies of uploaded photos.
 *
 * A guest's phone used to download every photo as uploaded — a 6 MB original
 * for an image shown 400 pixels wide. Resizing is CPU work, so it is not done
 * inside the upload request: the upload stores the original and returns, and
 * this runs from a sweep, a few photos at a time, finding its work by
 * `variantsProcessedAt` being empty. Photos uploaded before it existed are
 * picked up the same way.
 *
 * A file that cannot be read as an image is marked with the reason and not
 * tried again; the original keeps being served.
 */
@Injectable()
export class ImageVariantsService {
  private readonly logger = new Logger(ImageVariantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  async processPending(limit = 10): Promise<{ processed: number; failed: number }> {
    const pending = await this.prisma.mediaAsset.findMany({
      where: { variantsProcessedAt: null, kind: { in: PHOTO_KINDS }, mimeType: { in: [...RESIZABLE_TYPES] } },
      // Never tried before anything waiting on a retry, so a few unreachable
      // files cannot hold up every new upload.
      orderBy: [{ variantsError: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true, eventId: true, url: true, createdAt: true },
    });

    let failed = 0;
    for (const asset of pending) {
      const isDone = await this.process(asset);
      if (!isDone) failed += 1;
    }
    return { processed: pending.length - failed, failed };
  }

  private async process(asset: { id: string; eventId: string; url: string; createdAt: Date }): Promise<boolean> {
    let original: Buffer;
    try {
      original = await this.storage.get(storageKeyOf(asset.url));
    } catch (error) {
      // Storage being unreachable says nothing about the file: try it again
      // next sweep, for a day. It used to be marked unreadable for good.
      const isGivingUp = Date.now() - asset.createdAt.getTime() > STORAGE_RETRY_MS;
      await this.recordFailure(asset.id, `storage: ${describe(error)}`, isGivingUp);
      return false;
    }

    try {
      // Turned upright first: phone photos carry their orientation as a tag
      // that a resized copy would otherwise lose, leaving guests a sideways photo.
      const upright = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().toBuffer({ resolveWithObject: true });
      const variants = await this.makeVariants(asset.id, upright.data, upright.info.width);
      await this.recordVariants(asset, variants, upright.info);
      return true;
    } catch (error) {
      this.logger.warn(`could not resize media ${asset.id}: ${describe(error)}`);
      await this.recordFailure(asset.id, describe(error), true);
      return false;
    }
  }

  /**
   * Conditional on the row still being there: an upload removed while it was
   * being resized used to throw out of the whole sweep, and its new copies
   * were left in storage with nothing pointing at them (B87).
   */
  private async recordVariants(asset: { id: string; eventId: string }, variants: ImageVariant[], size: { width: number; height: number }) {
    const recorded = await this.prisma.mediaAsset.updateMany({
      where: { id: asset.id },
      data: {
        variants: variants as unknown as Prisma.InputJsonValue,
        width: size.width,
        height: size.height,
        variantsProcessedAt: new Date(),
        variantsError: null,
      },
    });
    if (recorded.count === 0) {
      await Promise.allSettled(variants.map((variant) => this.storage.removeByUrl(variant.url)));
      return;
    }
    await this.dropCachedInvitation(asset.eventId);
  }

  private async recordFailure(assetId: string, reason: string, isFinal: boolean): Promise<void> {
    await this.prisma.mediaAsset.updateMany({
      where: { id: assetId },
      data: { variantsError: reason.slice(0, 500), ...(isFinal ? { variantsProcessedAt: new Date() } : {}) },
    });
  }

  private async makeVariants(assetId: string, upright: Buffer, width: number): Promise<ImageVariant[]> {
    const variants: ImageVariant[] = [];
    for (const target of variantWidths(width)) {
      const copy = await sharp(upright, { limitInputPixels: MAX_INPUT_PIXELS }).resize({ width: target }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      const stored = await this.storage.put({ buffer: copy.data, originalName: `${assetId}-${target}.webp`, mimeType: 'image/webp' });
      variants.push({ width: copy.info.width, height: copy.info.height, url: stored.url, sizeBytes: copy.info.size });
    }
    return variants;
  }

  private async dropCachedInvitation(eventId: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({ where: { eventId }, select: { slug: true } });
    if (invitation) await this.cache.invalidateInvitation(invitation.slug);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
