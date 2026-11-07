import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, VendorCategory, type Prisma, type VendorBooking } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { resolvePaging, toPage } from '../../common/dto/pagination.dto';
import { lockRow } from '../../common/row-lock';
import { lockEventOrganization, requireCurrentEventPermission } from '../../infra/auth/access-locks';
import { PrismaService } from '../../prisma/prisma.service';
import { BookVendorDto, CreateVendorDto, UpdateBookingDto } from './dto/vendor.dto';
import type { VendorOptionsDto, VendorOptionsQuery } from './dto/vendor-options.dto';
import { BRIEF_SECTIONS, BRIEF_SECTION_PURPOSE, SUGGESTED_SCOPES, sectionsFor } from './vendor-brief';

const BOOKED_VENDOR = { select: { id: true, name: true, category: true } } as const;

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
          venueProfiles: { where: { isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, city: true, capacity: true } },
        },
      })
      .then((vendors) =>
        vendors.map(({ organizationId: owner, ...vendor }) => ({ ...vendor,
          // Compatibility for clients expecting the former single-hall summary.
          venueProfile: vendor.venueProfiles[0] ? { city: vendor.venueProfiles[0].city, capacity: vendor.venueProfiles[0].capacity } : null,
          isCurated: owner === null })),
      );
  }

  async listOptions(organizationId: string, query: VendorOptionsQuery): Promise<VendorOptionsDto> {
    const paging = resolvePaging(query);
    const where = { active: true, category: query.category, OR: [{ organizationId }, { organizationId: null }] };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where, ...paging,
        orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, category: true, organizationId: true },
      }),
      this.prisma.vendor.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    const items = rows.map(({ organizationId: owner, ...row }) => ({ ...row, isCurated: owner === null }));
    return {
      ...toPage(items, total, paging),
      sections: BRIEF_SECTIONS.map((section) => ({ section, purpose: BRIEF_SECTION_PURPOSE[section] })),
      defaults: Object.values(VendorCategory).map((category) => ({ category, scopes: sectionsFor(SUGGESTED_SCOPES[category]) })),
    };
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
      ...bookingSummary(booking),
      vendor: booking.vendor,
      ...(canShareBriefs ? { briefToken: booking.briefToken } : {}),
      ...(maySeeFees ? bookingFee(booking) : {}),
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
  book(eventId: string, dto: BookVendorDto, userId: string) {
    return this.withBookingWrite(eventId, userId, async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: dto.vendorId, OR: [{ organizationId: null }, { organization: { events: { some: { id: eventId } } } }] },
        select: { category: true },
      });
      if (!vendor) throw new NotFoundException('No such vendor');

      const where = { eventId_vendorId: { eventId, vendorId: dto.vendorId } };
      const existing = await tx.vendorBooking.findUnique({ where, select: { status: true, feeMinor: true, feeCurrency: true } });
      const isReopening = existing?.status === BookingStatus.CANCELLED;
      const briefToken = newBriefToken();
      const briefScopes = sectionsFor(dto.briefScopes ?? SUGGESTED_SCOPES[vendor.category] ?? []);
      const fee = bookingFeeChanges(dto, existing);
      const booking = await tx.vendorBooking.upsert({
        where,
        create: { eventId, vendorId: dto.vendorId, briefScopes, briefToken, ...fee },
        update: {
          ...(isReopening ? { status: BookingStatus.ENQUIRED, briefToken, isBriefEnabled: true } : {}),
          // Repeating an existing booking cannot widen scope or resume a pause.
          briefScopes: isReopening || dto.briefScopes !== undefined ? briefScopes : undefined,
          ...fee,
        },
        include: { vendor: BOOKED_VENDOR },
      });
      return { ...bookingSummary(booking), vendor: booking.vendor, briefToken: booking.briefToken, ...bookingFee(booking) };
    });
  }

  updateBooking(eventId: string, bookingId: string, dto: UpdateBookingDto, userId: string) {
    return this.withBookingWrite(eventId, userId, async (tx) => {
      const booking = await this.requireBooking(tx, eventId, bookingId);
      // The sent link explains cancellation, but a renewed engagement gets a fresh capability.
      const isReopening = booking.status === BookingStatus.CANCELLED && dto.status != null && dto.status !== BookingStatus.CANCELLED;
      const updated = await tx.vendorBooking.update({
        where: { id: booking.id },
        data: {
          briefToken: isReopening ? newBriefToken() : undefined,
          status: dto.status ?? undefined,
          isBriefEnabled: dto.isBriefEnabled,
          briefScopes: dto.briefScopes ? sectionsFor(dto.briefScopes) : undefined,
          ...bookingFeeChanges(dto, booking),
        },
        include: { vendor: BOOKED_VENDOR },
      });
      return { ...bookingSummary(updated), vendor: updated.vendor, ...bookingFee(updated) };
    });
  }

  /**
   * Replaces the brief link.
   *
   * The reason this exists: a brief token is a capability, so a link forwarded
   * to the wrong supplier cannot be un-sent. Rotation retires that credential
   * permanently, without lifting a pause or cancellation.
   */
  rotateBriefToken(eventId: string, bookingId: string, userId: string) {
    return this.withBookingWrite(eventId, userId, async (tx) => {
      const booking = await this.requireBooking(tx, eventId, bookingId);
      return tx.vendorBooking.update({
        where: { id: booking.id },
        data: { briefToken: newBriefToken() },
        select: { id: true, briefToken: true, isBriefEnabled: true },
      });
    });
  }

  /** Ends an engagement. The booking stays, so the fee history survives. */
  cancelBooking(eventId: string, bookingId: string, userId: string) {
    return this.withBookingWrite(eventId, userId, async (tx) => {
      const booking = await this.requireBooking(tx, eventId, bookingId);
      await tx.vendorBooking.update({ where: { id: booking.id }, data: { status: BookingStatus.CANCELLED } });
      return { ok: true as const };
    });
  }

  private async requireBooking(tx: Prisma.TransactionClient, eventId: string, bookingId: string) {
    const booking = await tx.vendorBooking.findFirst({
      where: { id: bookingId, eventId },
    });
    if (!booking) throw new NotFoundException('No such vendor booking on this event');
    return booking;
  }

  private withBookingWrite<T>(eventId: string, userId: string, write: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await lockEventOrganization(tx, eventId);
      // Serialize booking/token transitions with event standing changes, including a first booking.
      await lockRow(tx, 'events', eventId);
      await requireCurrentEventPermission(tx, { actor: { userId }, eventId, permission: 'vendor:write' });
      return write(tx);
    });
  }
}

function bookingSummary(booking: Pick<VendorBooking, 'id' | 'status' | 'briefScopes' | 'isBriefEnabled'>) {
  return { id: booking.id, status: booking.status, briefScopes: sectionsFor(booking.briefScopes), isBriefEnabled: booking.isBriefEnabled };
}

type BookingFee = Pick<VendorBooking, 'feeMinor' | 'feeCurrency'>;

function bookingFee(booking: BookingFee) {
  return { feeMinor: booking.feeMinor?.toString() ?? null, feeCurrency: booking.feeCurrency };
}

function bookingFeeChanges(dto: Pick<BookVendorDto, 'feeMinor' | 'feeCurrency'>, current: BookingFee | null) {
  const { feeCurrency, feeMinor } = dto;
  if (current?.feeMinor != null && feeCurrency !== undefined && feeCurrency !== current.feeCurrency.toUpperCase() && feeMinor === undefined) {
    throw new BadRequestException('feeMinor: include the amount when changing feeCurrency on a recorded fee');
  }
  return { feeCurrency, feeMinor: feeMinor == null ? feeMinor : BigInt(feeMinor) };
}

/** 32 bytes: a brief link is a capability, so it must not be guessable. */
function newBriefToken(): string {
  return randomBytes(32).toString('hex');
}
