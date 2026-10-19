import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { GuestMediaKind, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivateStorageService } from '../../infra/storage/private/private-storage';
import { lockGuestAccess, readGuestAccess } from './guest-access';
import { ContributionPageDto } from './contribution.dto';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MEBIBYTE = 1024 * 1024;
export const GALLERY_BYTE_LIMIT = 2 * 1024 * MEBIBYTE;
export const SIGNATURE_UPLOAD_LIMIT = MEBIBYTE;
export const GALLERY_UPLOAD_LIMIT = 10 * MEBIBYTE;
export const MEDIA_SELECT = { id: true, kind: true, processingStatus: true, moderationStatus: true, caption: true,
  width: true, height: true, createdAt: true, moderatedAt: true, failureReason: true } satisfies Prisma.GuestMediaSelect;

@Injectable()
export class GuestMediaService {
  constructor(private readonly prisma: PrismaService, private readonly storage: PrivateStorageService) {}

  async upload(link: { slug: string; token: string }, kind: GuestMediaKind, file: Express.Multer.File, caption?: string) {
    if (!IMAGE_TYPES.includes(file.mimetype)) throw new UnsupportedMediaTypeException('file: upload a JPEG, PNG, WebP or AVIF raster image');
    const max = kind === 'GALLERY' ? GALLERY_UPLOAD_LIMIT : SIGNATURE_UPLOAD_LIMIT;
    if (!file.buffer.length || file.buffer.length > max) throw new PayloadTooLargeException(`file: use a nonempty image of at most ${max} bytes`);
    const staged = await this.prisma.$transaction(async (tx) => {
      const guest = await lockGuestAccess(tx, link.slug, link.token);
      const reservedBytes = file.buffer.length + derivativeReservation(kind);
      await assertQuota(tx, { eventId: guest.eventId, guestId: guest.id, kind, reservedBytes });
      return tx.guestMedia.create({ data: { eventId: guest.eventId, uploaderGuestId: guest.id, kind,
        sourceKey: randomUUID(), mimeType: file.mimetype, sourceBytes: file.buffer.length, storedBytes: 0, reservedBytes,
        caption, leaseUntil: new Date(Date.now() + 120_000) } });
    });
    try {
      await this.storage.put(staged.sourceKey, file.buffer, file.mimetype);
      await readGuestAccess(this.prisma, link.slug, link.token);
      const claimed = await this.prisma.guestMedia.updateMany({ where: { id: staged.id, processingStatus: 'STAGING', uploaderGuestId: staged.uploaderGuestId },
        data: { processingStatus: 'QUEUED', leaseUntil: null, storedBytes: file.buffer.length } });
      if (!claimed.count) throw new NotFoundException('Upload no longer available');
      return await this.prisma.guestMedia.findUniqueOrThrow({ where: { id: staged.id }, select: MEDIA_SELECT });
    } catch (error) {
      await this.prisma.guestMedia.updateMany({ where: { id: staged.id }, data: { processingStatus: 'REMOVED', removedAt: new Date(), cleanupAfter: new Date() } });
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Private upload storage is unavailable; retry later');
    }
  }

  async listGuest(slug: string, token: string, page: ContributionPageDto) {
    const guest = await readGuestAccess(this.prisma, slug, token);
    const where: Prisma.GuestMediaWhereInput = { eventId: guest.eventId, kind: 'GALLERY', processingStatus: { not: 'REMOVED' },
      OR: [{ uploaderGuestId: guest.id }, { processingStatus: 'READY', moderationStatus: 'APPROVED' }] };
    const items = await this.list(where, page);
    return { items: items.map(({ uploaderGuestId, ...item }) => ({ ...item, isOwn: uploaderGuestId === guest.id })),
      nextCursor: items.length === page.limit ? items.at(-1)!.id : null,
      limits: { perGuest: 20, perEvent: 1000, bytesPerEvent: GALLERY_BYTE_LIMIT, bytesPerFile: GALLERY_UPLOAD_LIMIT } };
  }
  async listHost(eventId: string, page: ContributionPageDto) {
    const items = await this.list({ eventId, kind: 'GALLERY', processingStatus: { not: 'REMOVED' } }, page);
    return { items: items.map(({ uploaderGuestId: _uploader, ...item }) => item), nextCursor: items.length === page.limit ? items.at(-1)!.id : null };
  }
  private async list(where: Prisma.GuestMediaWhereInput, page: ContributionPageDto) {
    if (page.after && !await this.prisma.guestMedia.findFirst({ where: { ...where, id: page.after }, select: { id: true } })) throw new NotFoundException('Unknown gallery cursor');
    return this.prisma.guestMedia.findMany({ where, select: { ...MEDIA_SELECT, uploaderGuestId: true }, take: page.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(page.after ? { cursor: { id: page.after }, skip: 1 } : {}) });
  }

  async removeGuest(link: { slug: string; token: string }, id: string, kind: GuestMediaKind) {
    return this.prisma.$transaction(async (tx) => {
      const guest = await lockGuestAccess(tx, link.slug, link.token);
      await tx.$queryRaw`SELECT id FROM guest_media WHERE id = ${id} FOR UPDATE`;
      const image = await tx.guestMedia.findFirst({ where: { id, eventId: guest.eventId, uploaderGuestId: guest.id, kind, processingStatus: { not: 'REMOVED' } } });
      if (!image) throw new NotFoundException('No such upload');
      if (image.kind === 'SIGNATURE' && await tx.guestAcknowledgement.count({ where: { mediaId: id } })) throw new ConflictException('Signature is part of an acknowledgement; use the privacy request process');
      await markRemoved(tx, id); return { removed: id };
    });
  }
  async removeHost(eventId: string, id: string) {
    const updated = await this.prisma.guestMedia.updateMany({ where: { id, eventId, kind: 'GALLERY', processingStatus: { not: 'REMOVED' } },
      data: { processingStatus: 'REMOVED', removedAt: new Date(), cleanupAfter: new Date(), caption: null } });
    if (!updated.count) throw new NotFoundException('No such photo');
    return { removed: id };
  }
  async moderate(eventId: string, id: string, status: 'APPROVED' | 'REJECTED', userId: string) {
    const changed = await this.prisma.guestMedia.updateMany({ where: { id, eventId, kind: 'GALLERY', processingStatus: 'READY' },
      data: { moderationStatus: status, moderatedBy: userId, moderatedAt: new Date() } });
    if (!changed.count) throw new ConflictException('Photo must finish processing and remain available before moderation');
    return this.prisma.guestMedia.findUniqueOrThrow({ where: { id }, select: MEDIA_SELECT });
  }

  async readGuest(link: { slug: string; token: string }, id: string, options: { kind: GuestMediaKind; variant: 'display' | 'thumbnail'; acknowledgementId?: string }) {
    const authorize = async () => {
      const guest = await readGuestAccess(this.prisma, link.slug, link.token);
      const visibility: Prisma.GuestMediaWhereInput[] = [{ uploaderGuestId: guest.id }];
      if (options.kind === 'GALLERY') visibility.push({ moderationStatus: 'APPROVED' });
      if (options.acknowledgementId) visibility.push({ acknowledgements: { some: { id: options.acknowledgementId,
        OR: [{ signerGuestId: guest.id }, { subject: { householdId: guest.householdId } }] } } });
      const image = await this.prisma.guestMedia.findFirst({ where: { id, eventId: guest.eventId, kind: options.kind, processingStatus: 'READY', OR: visibility } });
      if (!image) throw new NotFoundException('No image available');
      return image;
    };
    const image = await authorize(); const result = await this.readProcessed(image, options.variant);
    await authorize(); return result;
  }
  async readHost(eventId: string, id: string, kind: GuestMediaKind, variant: 'display' | 'thumbnail') {
    const authorize = () => this.prisma.guestMedia.findFirst({ where: { id, eventId, kind, processingStatus: 'READY' } });
    const image = await authorize();
    if (!image) throw new NotFoundException('No image available');
    const result = await this.readProcessed(image, variant);
    if (!await authorize()) throw new NotFoundException('No image available');
    return result;
  }
  private async readProcessed(image: { kind: GuestMediaKind; displayKey: string | null; thumbnailKey: string | null }, variant: 'display' | 'thumbnail') {
    const key = variant === 'thumbnail' ? image.thumbnailKey : image.displayKey;
    if (!key) throw new BadRequestException('variant: this image has no such variant');
    return { buffer: await this.storage.get(key), mimeType: image.kind === 'SIGNATURE' ? 'image/png' : 'image/webp' };
  }
}
function derivativeReservation(kind: GuestMediaKind) { return kind === 'GALLERY' ? 2560 * 1024 : MEBIBYTE; }
async function assertQuota(tx: Prisma.TransactionClient, request: { eventId: string; guestId: string; kind: GuestMediaKind; reservedBytes: number }) {
  const where = { eventId: request.eventId, kind: request.kind, processingStatus: { not: 'REMOVED' as const } };
  const [count, own, storage] = await Promise.all([
    tx.guestMedia.count({ where }), tx.guestMedia.count({ where: { ...where, uploaderGuestId: request.guestId } }),
    tx.guestMedia.aggregate({ where: { eventId: request.eventId, kind: request.kind, clearedAt: null }, _sum: { reservedBytes: true } }),
  ]);
  const limit = request.kind === 'GALLERY' ? 1000 : 5000;
  if (count >= limit || own >= 20) throw new ConflictException('uploads: photo count limit reached; remove an unused upload first');
  if ((storage._sum.reservedBytes ?? 0) + request.reservedBytes > GALLERY_BYTE_LIMIT) throw new ConflictException('uploads: private storage limit reached; removed files must be reclaimed before retrying');
}
export async function markRemoved(tx: Prisma.TransactionClient, id: string) {
  await tx.guestMedia.update({ where: { id }, data: { processingStatus: 'REMOVED', removedAt: new Date(), cleanupAfter: new Date(), caption: null } });
}
