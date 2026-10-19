import { PUBLIC_UPLOAD_KINDS } from './dto/upload-media.dto';
import { languageKeysProblem } from '../../common/field-translations';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MediaKind, Prisma } from '@prisma/client';
import { mergeTranslations } from '../design/translated-content';
import { lockRow } from '../../common/row-lock';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { StorageService } from '../../infra/storage/storage.service';

/** What a host uploaded. Exports and drawn signatures are stored as media too, and are not theirs to manage here. */
const UPLOAD_KINDS: MediaKind[] = [MediaKind.PHOTO, MediaKind.COVER, MediaKind.LOGO, MediaKind.AUDIO];

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Stores a file and records it against the event.
   *
   * The storage write happens first: a MediaAsset row pointing at a file that
   * was never written is worse than an orphaned file, because the invitation
   * would render a broken image. An orphan costs disk and is reclaimable.
   */
  async upload(eventId: string, file: Express.Multer.File, requestedKind?: MediaKind) {
    const kind = requestedKind ?? kindFor(file.mimetype);
    if (!PUBLIC_UPLOAD_KINDS.includes(kind) || (kind === MediaKind.AUDIO) !== file.mimetype.startsWith('audio/')) {
      throw new BadRequestException('kind: AUDIO requires audio; PHOTO, COVER and LOGO require an image');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException(`No event ${eventId}`);

    const stored = await this.storage.put({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
    });

    // The event can be deleted while the file is uploading; its row then
    // cannot be written, and the file would be left with nothing pointing at
    // it (B87). It goes back out instead.
    const asset = await this.prisma.mediaAsset
      .create({
        data: {
          eventId,
          kind,
          url: stored.url,
          sizeBytes: stored.sizeBytes,
          mimeType: stored.mimeType,
        },
      })
      .catch(async (error: unknown) => {
        await this.storage.removeByUrl(stored.url);
        throw error;
      });

    return { id: asset.id, url: asset.url, kind: asset.kind, sizeBytes: asset.sizeBytes };
  }

  /**
   * Every upload on the event, newest first, with the blocks that show each —
   * so a host can see what they have and what removing one would break.
   */
  async list(eventId: string) {
    const [assets, blocks, listing] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where: { eventId, kind: { in: UPLOAD_KINDS } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          url: true,
          kind: true,
          mimeType: true,
          sizeBytes: true,
          altText: true,
          width: true,
          height: true,
          variants: true,
          variantsProcessedAt: true,
          createdAt: true,
        },
      }),
      this.blocksShowingMedia(eventId),
      this.prisma.eventListing.findUnique({ where: { eventId }, select: { heroAssetId: true, ogImageId: true } }),
    ]);

    return assets.map((asset) => ({
      ...asset,
      listingUses: [listing?.heroAssetId === asset.id ? 'HERO' : null, listing?.ogImageId === asset.id ? 'SHARE' : null].filter((use) => use !== null),
      usedBy: blocks.filter((block) => block.assetIds.includes(asset.id)).map((block) => block.type),
    }));
  }

  /**
   * Describes an upload for guests who cannot see it, one language at a time
   * — the same rule as block content: a language sent replaces that one,
   * `null` removes it, the rest are kept.
   */
  async updateAltText(eventId: string, assetId: string, altText: Record<string, unknown>) {
    const keys = languageKeysProblem('altText', altText);
    if (keys) throw new BadRequestException(keys);
    const invalid = Object.entries(altText).find(([, text]) => !isAltText(text));
    if (invalid) throw new BadRequestException(`altText: ${invalid[0]} must be text of at most 300 characters, or null`);
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'media_assets', assetId);
      const asset = await tx.mediaAsset.findFirst({ where: { id: assetId, eventId, kind: { in: UPLOAD_KINDS } } });
      if (!asset) throw new NotFoundException(`No upload ${assetId} on this event`);
      return tx.mediaAsset.update({
        where: { id: asset.id },
        data: { altText: mergeTranslations(asset.altText, altText) as Prisma.InputJsonValue },
        select: { id: true, url: true, kind: true, altText: true },
      });
    });
    await this.dropCachedInvitation(eventId);
    return updated;
  }

  /**
   * Removes an upload, file and all — refused while a block shows it, because
   * the page guests already hold would show a broken image. The row goes
   * first: an orphaned file costs disk; a row pointing at a deleted file
   * breaks the page.
   */
  async remove(eventId: string, assetId: string) {
    const asset = await this.prisma.$transaction(async (tx) => {
      // Locked before checking where it is shown: a block attaching it at the
      // same moment takes a share lock on it, so one waits for the other —
      // never a block showing a file just deleted (B87).
      await lockRow(tx, 'media_assets', assetId);
      const found = await tx.mediaAsset.findFirst({ where: { id: assetId, eventId, kind: { in: UPLOAD_KINDS } } });
      if (!found) throw new NotFoundException(`No upload ${assetId} on this event`);
      const blocks = await tx.invitationBlock.findMany({
        where: { invitation: { eventId }, assetIds: { has: assetId } },
        select: { type: true },
      });
      if (blocks.length > 0) {
        throw new ConflictException(`The ${blocks.map((block) => block.type).join(', ')} block shows this; take it off there first`);
      }
      const listing = await tx.eventListing.findFirst({ where: { eventId, OR: [{ heroAssetId: assetId }, { ogImageId: assetId }] }, select: { id: true } });
      if (listing) throw new ConflictException('The listing uses this image; clear heroAssetId and ogImageId first');
      await tx.mediaAsset.delete({ where: { id: assetId } });
      return found;
    });

    await Promise.all(urlsOf(asset).map((url) => this.storage.removeByUrl(url)));
    return { removed: asset.id };
  }

  private async requireUpload(eventId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, eventId, kind: { in: UPLOAD_KINDS } },
    });
    if (!asset) throw new NotFoundException(`No upload ${assetId} on this event`);
    return asset;
  }

  /** The invitation's blocks that show media. A handful per event, read once. */
  private blocksShowingMedia(eventId: string) {
    return this.prisma.invitationBlock.findMany({
      where: { invitation: { eventId }, NOT: { assetIds: { isEmpty: true } } },
      select: { type: true, assetIds: true },
    });
  }

  private async dropCachedInvitation(eventId: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({ where: { eventId }, select: { slug: true } });
    if (invitation) await this.cache.invalidateInvitation(invitation.slug);
  }
}

/** The original and every smaller copy made of it. */
export function urlsOf(asset: { url: string; variants: unknown }): string[] {
  const variants = Array.isArray(asset.variants) ? (asset.variants as { url?: unknown }[]) : [];
  return [asset.url, ...variants.map((variant) => variant.url).filter((url): url is string => typeof url === 'string')];
}

/** A lookup rather than a branch, so a new accepted type is a new row. */
const KIND_BY_MIME_PREFIX: [string, MediaKind][] = [
  ['image/', MediaKind.PHOTO],
  ['audio/', MediaKind.AUDIO],
];

function kindFor(mimeType: string): MediaKind {
  return KIND_BY_MIME_PREFIX.find(([prefix]) => mimeType.startsWith(prefix))?.[1] ?? MediaKind.PHOTO;
}

function isAltText(text: unknown): boolean {
  return text === null || (typeof text === 'string' && text.length <= 300);
}
