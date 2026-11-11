import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma, RsvpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTranslation } from '../../common/locale';
import { translatedField } from '../../common/field-translations';
import { OperationsService } from '../operations/operations.service';
import { BRIEF_SECTION_PURPOSE, BriefSection, sectionsFor } from './vendor-brief';
import { readPublishedVendorSeating } from './vendor-seating';

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
  ) {}

  findByToken(briefToken: string) {
    // The credential and every disclosed value must have coexisted in an authorized snapshot.
    return this.prisma.$transaction((tx) => this.readBrief(tx, briefToken), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async readBrief(tx: Prisma.TransactionClient, briefToken: string) {
    const booking = await tx.vendorBooking.findUnique({
      where: { briefToken },
      select: {
        eventId: true,
        status: true,
        briefScopes: true,
        isBriefEnabled: true,
        vendor: { select: { name: true, category: true } },
        event: { select: briefEventSelect },
      },
    });

    if (!booking) throw new NotFoundException('This brief link is not valid');
    if (booking.status === BookingStatus.CANCELLED) {
      throw new ForbiddenException('This engagement has been cancelled');
    }
    if (!booking.isBriefEnabled) throw new ForbiddenException('This brief is paused by the host');

    const sections = sectionsFor(booking.briefScopes);
    const content = await this.buildSections(tx, booking.eventId, sections, booking.event.defaultLocale);

    return {
      vendor: booking.vendor,
      status: booking.status,
      // The event's own language, decided for vendors (design C-45); named so the page can mark it.
      locale: booking.event.defaultLocale,
      event: briefEvent(booking.event),
      // Stating the scope in the response is deliberate: a vendor who can see
      // what they were and were not given does not ask for the rest by email.
      granted: sections.filter((section) => content[section] !== undefined).map((section) => ({
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
  private async headcount(eventId: string, operations: OperationsService) {
    const { byHousehold: _named, trend: _history, ...counts } = await operations.headcount(eventId);
    return counts;
  }

  private async buildSections(tx: Prisma.TransactionClient, eventId: string, sections: BriefSection[], locale: string) {
    const operations = this.operations.inTransaction(tx, locale);
    const builders = {
      headcount: () => this.headcount(eventId, operations),
      catering: () => operations.cateringSheet(eventId),
      bar: () => operations.barSheet(eventId),
      playlist: () => operations.playlist(eventId),
      timeline: () => this.timeline(tx, eventId, locale),
      seating: () => readPublishedVendorSeating(tx, eventId),
      households: () => this.households(tx, eventId),
      contacts: () => this.contacts(tx, eventId),
    } satisfies Record<BriefSection, () => Promise<unknown>>;

    const built = await Promise.all(sections.map((section) => builders[section]()));
    type Sections = Partial<{ [Key in BriefSection]: Awaited<ReturnType<(typeof builders)[Key]>> }>;
    return Object.fromEntries(sections.map((section, index) => [section, built[index]])) as Sections;
  }

  /** Labels are translated; a vendor gets the event's own language. */
  private async timeline(tx: Prisma.TransactionClient, eventId: string, locale: string) {
    const entries = await tx.timelineEntry.findMany({
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
  private async households(tx: Prisma.TransactionClient, eventId: string) {
    const households = await tx.household.findMany({
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

  private async contacts(tx: Prisma.TransactionClient, eventId: string) {
    const guests = await tx.guest.findMany({
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

const briefEventSelect = {
  title: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  defaultLocale: true,
  translations: true,
  sideALabel: true,
  sideBLabel: true,
  venues: {
    select: { role: true, name: true, address: true, translations: true, arriveAt: true, mapUrl: true },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.EventSelect;

/** The event's words in its default language, falling back to the typed original as the guest page does. */
function briefEvent(event: Prisma.EventGetPayload<{ select: typeof briefEventSelect }>) {
  const locale = event.defaultLocale;
  const inLanguage = (translations: unknown, field: string, original: string | null) =>
    translatedField(translations, locale, field) ?? original;
  return {
    title: inLanguage(event.translations, 'title', event.title),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    sides: { a: inLanguage(event.translations, 'sideALabel', event.sideALabel), b: inLanguage(event.translations, 'sideBLabel', event.sideBLabel) },
    venues: event.venues.map(({ translations, ...venue }) => ({
      ...venue,
      name: inLanguage(translations, 'name', venue.name),
      address: inLanguage(translations, 'address', venue.address),
    })),
  };
}
