import { Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma, VendorCategory } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BookVendorDto, CreateVendorDto, UpdateBookingDto } from './dto/vendor.dto';
import { SUGGESTED_SCOPES, sectionsFor } from './vendor-brief';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The vendors an organization can choose from: its own, and Aveline's
   * curated list (decided 9 October 2026). The directory used to be one list
   * every customer read and wrote, so host B saw the phone number host A
   * entered for their cousin the photographer.
   */
  listVendors(organizationId: string | null, category?: VendorCategory) {
    return this.prisma.vendor
      .findMany({
        where: { active: true, category, OR: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])] },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          name: true,
          category: true,
          email: true,
          phone: true,
          venueProfile: { select: { city: true, capacity: true } },
        },
      })
      .then((vendors) =>
        vendors.map(({ organizationId: owner, ...vendor }) => ({ ...vendor, isCurated: owner === null })),
      );
  }

  /**
   * Adds a vendor: to the caller's organization, or — for Aveline staff,
   * who belong to none — to the curated list everyone sees.
   */
  createVendor(organizationId: string | null, dto: CreateVendorDto) {
    return this.prisma.vendor.create({
      data: {
        organizationId,
        name: dto.name,
        category: dto.category,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  /**
   * This event's vendors.
   *
   * `maySeeFees` comes from the caller's permissions, not from a query
   * parameter: `vendor:fee:read` is separate from `vendor:read` precisely so a
   * designer or a junior coordinator can work with the vendor list without
   * seeing commercial terms (ACCESS_CONTROL §3). The brief link likewise only
   * to a caller who may manage vendors: it is a credential, and one carrying
   * the `contacts` scope reads guests' phone numbers.
   */
  async listBookings(eventId: string, maySeeFees: boolean, canShareBriefs: boolean) {
    const bookings = await this.prisma.vendorBooking.findMany({
      where: { eventId },
      include: { vendor: { select: { id: true, name: true, category: true, email: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return bookings.map((booking) => ({
      id: booking.id,
      vendor: booking.vendor,
      status: booking.status,
      briefScopes: sectionsFor(booking.briefScopes),
      ...(canShareBriefs ? { briefToken: booking.briefToken } : {}),
      ...(maySeeFees
        ? { feeAmount: booking.feeAmount?.toString() ?? null, feeCurrency: booking.feeCurrency }
        : {}),
      createdAt: booking.createdAt,
    }));
  }

  /**
   * Engages a vendor for an event and mints their brief link.
   *
   * Scopes default to the category's usual set rather than to everything: a
   * host who does not think about scopes should end up with a caterer who
   * cannot read the playlist, not one who can read the guest list.
   */
  async book(eventId: string, dto: BookVendorDto) {
    // Aveline's list, or this event's own organization's: never another's.
    const vendor = await this.prisma.vendor.findFirst({
      where: {
        id: dto.vendorId,
        OR: [{ organizationId: null }, { organization: { events: { some: { id: eventId } } } }],
      },
    });
    if (!vendor) throw new NotFoundException('No such vendor');

    const briefScopes = dto.briefScopes ?? SUGGESTED_SCOPES[vendor.category] ?? [];

    const booking = await this.prisma.vendorBooking.upsert({
      where: { eventId_vendorId: { eventId, vendorId: dto.vendorId } },
      create: {
        eventId,
        vendorId: dto.vendorId,
        briefScopes: sectionsFor(briefScopes),
        briefToken: newBriefToken(),
        feeAmount: dto.feeAmount === undefined ? null : new Prisma.Decimal(dto.feeAmount),
      },
      // Re-booking the same vendor is editing the existing engagement, not a
      // second one — the unique constraint says so, and so does the host's
      // intent when they click the same vendor twice.
      update: {
        briefScopes: sectionsFor(briefScopes),
        feeAmount: dto.feeAmount === undefined ? undefined : new Prisma.Decimal(dto.feeAmount),
      },
      include: { vendor: { select: { id: true, name: true, category: true } } },
    });

    return {
      id: booking.id,
      vendor: booking.vendor,
      status: booking.status,
      briefScopes: sectionsFor(booking.briefScopes),
      briefToken: booking.briefToken,
      feeAmount: booking.feeAmount?.toString() ?? null,
    };
  }

  async updateBooking(eventId: string, bookingId: string, dto: UpdateBookingDto) {
    await this.requireBooking(eventId, bookingId);

    const updated = await this.prisma.vendorBooking.update({
      where: { id: bookingId },
      data: {
        status: dto.status ?? undefined,
        briefScopes: dto.briefScopes ? sectionsFor(dto.briefScopes) : undefined,
        feeAmount: dto.feeAmount === undefined ? undefined : new Prisma.Decimal(dto.feeAmount),
      },
      include: { vendor: { select: { id: true, name: true, category: true } } },
    });

    return {
      id: updated.id,
      vendor: updated.vendor,
      status: updated.status,
      briefScopes: sectionsFor(updated.briefScopes),
      feeAmount: updated.feeAmount?.toString() ?? null,
    };
  }

  /**
   * Replaces the brief link.
   *
   * The reason this exists: a brief token is a capability, so a link forwarded
   * to the wrong supplier cannot be un-sent. Rotation is the only revocation a
   * capability URL has.
   */
  async rotateBriefToken(eventId: string, bookingId: string) {
    await this.requireBooking(eventId, bookingId);

    const rotated = await this.prisma.vendorBooking.update({
      where: { id: bookingId },
      data: { briefToken: newBriefToken() },
      select: { id: true, briefToken: true },
    });
    return rotated;
  }

  /** Ends an engagement. The booking stays, so the fee history survives. */
  async cancelBooking(eventId: string, bookingId: string) {
    await this.requireBooking(eventId, bookingId);

    await this.prisma.vendorBooking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED, briefToken: newBriefToken() },
    });
    return { ok: true as const };
  }

  private async requireBooking(eventId: string, bookingId: string) {
    const booking = await this.prisma.vendorBooking.findFirst({
      where: { id: bookingId, eventId },
    });
    if (!booking) throw new NotFoundException('No such vendor booking on this event');
    return booking;
  }
}

/** 32 bytes: a brief link is a capability, so it must not be guessable. */
function newBriefToken(): string {
  return randomBytes(32).toString('hex');
}
