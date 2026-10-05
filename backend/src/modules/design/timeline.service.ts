import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../../infra/cache/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertTimelineEntryDto } from './dto/design.dto';

/**
 * The running order: ceremony, reception, first dance, cake, close.
 *
 * Typed once and then read by three things already built — the invitation's
 * TIMELINE block, the day-of vendor brief, and the operations view — which is
 * why it had become the most conspicuous hole in the product: all three bound
 * to data nothing could create.
 *
 * Entries are ordered by when they happen rather than by a sortOrder a client
 * has to maintain. `sortOrder` breaks ties, which is what makes two things at
 * the same minute — "doors open" and "music starts" — presentable.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  list(eventId: string) {
    return this.prisma.timelineEntry.findMany({
      where: { eventId },
      orderBy: [{ occursAt: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        label: true,
        occursAt: true,
        sortOrder: true,
        venue: { select: { id: true, name: true } },
      },
    });
  }

  async create(eventId: string, dto: UpsertTimelineEntryDto) {
    await this.assertEventExists(eventId);
    if (dto.venueId) await this.assertVenueBelongsToEvent(eventId, dto.venueId);
    assertHasLabel(dto);

    const entry = await this.prisma.timelineEntry.create({
      data: {
        eventId,
        label: dto.label as Prisma.InputJsonValue,
        occursAt: new Date(dto.occursAt),
        venueId: dto.venueId ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    // The TIMELINE block renders from this, and the invitation payload is
    // cached per slug and locale.
    await this.invalidateInvitation(eventId);
    return entry;
  }

  /** Omitted means "leave as is". */
  async update(eventId: string, entryId: string, dto: Partial<UpsertTimelineEntryDto>) {
    await this.requireEntry(eventId, entryId);
    if (dto.venueId) await this.assertVenueBelongsToEvent(eventId, dto.venueId);
    if (dto.label) assertHasLabel({ label: dto.label });

    const updated = await this.prisma.timelineEntry.update({
      where: { id: entryId },
      data: {
        label: dto.label as Prisma.InputJsonValue | undefined,
        occursAt: dto.occursAt === undefined ? undefined : new Date(dto.occursAt),
        venueId: dto.venueId ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
    });

    await this.invalidateInvitation(eventId);
    return updated;
  }

  async remove(eventId: string, entryId: string) {
    await this.requireEntry(eventId, entryId);

    await this.prisma.timelineEntry.delete({ where: { id: entryId } });
    await this.invalidateInvitation(eventId);
    return { ok: true as const };
  }

  private async requireEntry(eventId: string, entryId: string) {
    const entry = await this.prisma.timelineEntry.findFirst({
      where: { id: entryId, eventId },
    });
    if (!entry) throw new NotFoundException('No such timeline entry on this event');
    return entry;
  }

  private async assertEventExists(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException(`No event ${eventId}`);
  }

  /** A venue from another event would put someone else's address on the page. */
  private async assertVenueBelongsToEvent(eventId: string, venueId: string): Promise<void> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, eventId },
      select: { id: true },
    });
    if (!venue) throw new BadRequestException('That venue is not on this event');
  }

  private async invalidateInvitation(eventId: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { eventId },
      select: { slug: true },
    });
    if (invitation) await this.cache.invalidateInvitation(invitation.slug);
  }
}

/**
 * A timeline entry with no label in any language renders as a blank row on the
 * invitation, which reads as a bug to the guests looking at it.
 */
function assertHasLabel(dto: { label: Record<string, unknown> }): void {
  if (Object.keys(dto.label).length === 0) {
    throw new BadRequestException('label: give the entry a name in at least one language');
  }
}
