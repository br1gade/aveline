import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, RsvpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTranslation } from '../../common/locale';
import { OperationsService } from '../operations/operations.service';
import { SeatingService } from '../seating/seating.service';
import { BRIEF_SECTION_PURPOSE, BriefSection, sectionsFor } from './vendor-brief';

/**
 * The vendor-facing brief.
 *
 * Assembly iterates the booking's granted sections and calls the builder for
 * each. A section with no entry in the table cannot appear in the output, so
 * widening a brief is impossible without editing this file — which is the
 * point. The alternative, building everything and then filtering, leaks the
 * first time someone forgets a filter.
 */
@Injectable()
export class VendorBriefsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsService,
    private readonly seating: SeatingService,
  ) {}

  async findByToken(briefToken: string) {
    const booking = await this.prisma.vendorBooking.findUnique({
      where: { briefToken },
      include: {
        vendor: { select: { name: true, category: true } },
        event: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            timezone: true,
            defaultLocale: true,
            venues: {
              select: { role: true, name: true, address: true, arriveAt: true, mapUrl: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!booking) throw new NotFoundException('This brief link is not valid');
    if (booking.status === BookingStatus.CANCELLED) {
      throw new ForbiddenException('This engagement has been cancelled');
    }

    const sections = sectionsFor(booking.briefScopes);
    const content = await this.buildSections(booking.eventId, sections, booking.event.defaultLocale);

    return {
      vendor: booking.vendor,
      status: booking.status,
      event: {
        title: booking.event.title,
        startsAt: booking.event.startsAt,
        endsAt: booking.event.endsAt,
        timezone: booking.event.timezone,
        venues: booking.event.venues,
      },
      // Stating the scope in the response is deliberate: a vendor who can see
      // what they were and were not given does not ask for the rest by email.
      granted: sections.map((section) => ({
        section,
        purpose: BRIEF_SECTION_PURPOSE[section],
      })),
      ...content,
    };
  }

  /**
   * The numbers, without `byHousehold`: that breakdown names every family,
   * which only the `households` scope gives. A caterer, whose default scopes
   * include headcount, was reading the guest list through it.
   */
  private async headcount(eventId: string) {
    const { byHousehold: _named, ...counts } = await this.operations.headcount(eventId);
    return counts;
  }

  private async buildSections(eventId: string, sections: BriefSection[], locale: string) {
    const builders: Record<BriefSection, () => Promise<unknown>> = {
      headcount: () => this.headcount(eventId),
      catering: () => this.operations.cateringSheet(eventId),
      bar: () => this.operations.barSheet(eventId),
      playlist: () => this.operations.playlist(eventId),
      timeline: () => this.timeline(eventId, locale),
      seating: () => this.seating.listTables(eventId),
      households: () => this.households(eventId),
      contacts: () => this.contacts(eventId),
    };

    // Independent reads, so the brief costs the slowest section rather than
    // their sum.
    const built = await Promise.all(sections.map((section) => builders[section]()));
    return Object.fromEntries(sections.map((section, index) => [section, built[index]]));
  }

  /** Labels are translated; a vendor gets the event's own language. */
  private async timeline(eventId: string, locale: string) {
    const entries = await this.prisma.timelineEntry.findMany({
      where: { eventId },
      orderBy: [{ occursAt: 'asc' }, { sortOrder: 'asc' }],
      select: { label: true, occursAt: true, venue: { select: { name: true } } },
    });

    return entries.map((entry) => ({
      label: resolveTranslation<string>(entry.label, locale, locale),
      occursAt: entry.occursAt,
      venue: entry.venue?.name ?? null,
    }));
  }

  /**
   * Households of confirmed guests, names only.
   *
   * A photographer needs to know which five people are one family to get them
   * into one frame. They do not need anyone's phone number, which is why
   * contacts is a separate section nobody is granted by default.
   */
  private async households(eventId: string) {
    const households = await this.prisma.household.findMany({
      where: { eventId, guests: { some: { rsvp: { status: RsvpStatus.ATTENDING } } } },
      select: {
        name: true,
        guests: {
          where: { rsvp: { status: RsvpStatus.ATTENDING } },
          select: { firstName: true, lastName: true },
          orderBy: { isPrimary: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return households.map((household) => ({
      household: household.name,
      guests: household.guests.map((guest) =>
        [guest.firstName, guest.lastName].filter(Boolean).join(' '),
      ),
    }));
  }

  private async contacts(eventId: string) {
    const guests = await this.prisma.guest.findMany({
      where: { eventId, rsvp: { status: RsvpStatus.ATTENDING } },
      select: { firstName: true, lastName: true, email: true, phone: true },
      orderBy: { firstName: 'asc' },
    });

    return guests.map((guest) => ({
      name: [guest.firstName, guest.lastName].filter(Boolean).join(' '),
      email: guest.email,
      phone: guest.phone,
    }));
  }
}
