import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Stores a file and records it against the event.
   *
   * The storage write happens first: a MediaAsset row pointing at a file that
   * was never written is worse than an orphaned file, because the invitation
   * would render a broken image. An orphan costs disk and is reclaimable.
   */
  async upload(eventId: string, file: Express.Multer.File) {
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

    const asset = await this.prisma.mediaAsset.create({
      data: {
        eventId,
        kind: kindFor(file.mimetype),
        url: stored.url,
        sizeBytes: stored.sizeBytes,
        mimeType: stored.mimeType,
      },
    });

    return { id: asset.id, url: asset.url, kind: asset.kind, sizeBytes: asset.sizeBytes };
  }
}

/** A lookup rather than a branch, so a new accepted type is a new row. */
const KIND_BY_MIME_PREFIX: [string, MediaKind][] = [
  ['image/', MediaKind.PHOTO],
  ['audio/', MediaKind.AUDIO],
];

function kindFor(mimeType: string): MediaKind {
  return KIND_BY_MIME_PREFIX.find(([prefix]) => mimeType.startsWith(prefix))?.[1] ?? MediaKind.PHOTO;
}
