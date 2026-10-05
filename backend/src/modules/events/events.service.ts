import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId?: string) {
    return this.prisma.event.findMany({
      where: organizationId ? { organizationId } : undefined,
      include: { invitation: { select: { slug: true, status: true } }, _count: { select: { guests: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        venues: { orderBy: { sortOrder: 'asc' } },
        timeline: { orderBy: { occursAt: 'asc' } },
        invitation: true,
        _count: { select: { guests: true, households: true, tables: true } },
      },
    });
    if (!event) throw new NotFoundException(`No event ${id}`);
    return event;
  }
  /**
   * Changes the settings a host can reasonably flip themselves.
   *
   * Deliberately narrow: this is not a general event PATCH. Title, date and
   * venue changes affect an invitation people already hold, so they belong
   * with the flows that know how to tell those guests — not in a settings
   * toggle.
   */
  async updateSettings(eventId: string, settings: { remindersEnabled?: boolean }) {
    await this.findOne(eventId);

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { remindersEnabled: settings.remindersEnabled ?? undefined },
      select: { id: true, remindersEnabled: true },
    });
    return updated;
  }

}