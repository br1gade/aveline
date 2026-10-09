import { Injectable, Logger } from '@nestjs/common';
import { MediaKind, Prisma } from '@prisma/client';
import sharp from 'sharp';
import { CacheService } from '../../infra/cache/cache.service';
import { StorageService, storageKeyOf } from '../../infra/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageVariant, RESIZABLE_TYPES, variantWidths } from './image-variants';

const PHOTO_KINDS: MediaKind[] = [MediaKind.PHOTO, MediaKind.COVER, MediaKind.LOGO];

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
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, eventId: true, url: true },
    });

    let failed = 0;
    for (const asset of pending) {
      const isDone = await this.process(asset);
      if (!isDone) failed += 1;
    }
    return { processed: pending.length - failed, failed };
  }

  private async process(asset: { id: string; eventId: string; url: string }): Promise<boolean> {
    try {
      const original = await this.storage.get(storageKeyOf(asset.url));
      // Turned upright first: phone photos carry their orientation as a tag
      // that a resized copy would otherwise lose, leaving guests a sideways photo.
      const upright = await sharp(original).rotate().toBuffer({ resolveWithObject: true });
      const variants = await this.makeVariants(asset.id, upright.data, upright.info.width);

      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          variants: variants as unknown as Prisma.InputJsonValue,
          width: upright.info.width,
          height: upright.info.height,
          variantsProcessedAt: new Date(),
          variantsError: null,
        },
      });
      await this.dropCachedInvitation(asset.eventId);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`could not resize media ${asset.id}: ${reason}`);
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { variantsProcessedAt: new Date(), variantsError: reason.slice(0, 500) },
      });
      return false;
    }
  }

  private async makeVariants(assetId: string, upright: Buffer, width: number): Promise<ImageVariant[]> {
    const variants: ImageVariant[] = [];
    for (const target of variantWidths(width)) {
      const copy = await sharp(upright).resize({ width: target }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
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
