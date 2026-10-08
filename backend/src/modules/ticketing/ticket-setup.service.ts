import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus, EventVisibility, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify } from '../events/invitation-slug';
import {
  CreateTicketTypeDto,
  UpdateTicketTypeDto,
  UpsertListingDto,
} from './dto/ticket-setup.dto';
import { canDeleteTicketType, ticketTypeChangeProblems } from './ticket-type-rules';

/**
 * Setting up a public event: what is for sale, and the page that sells it.
 *
 * Until this existed the buying side was complete — checkout, inventory,
 * admission at the door — and there was no way to create the thing being
 * sold. Nothing in the codebase created an `EventListing` or a `TicketType`;
 * every ticketing test seeded both directly, which is exactly how the gap
 * stayed invisible.
 */
@Injectable()
export class TicketSetupService {
  constructor(private readonly prisma: PrismaService) {}

  // ── ticket types ─────────────────────────────────────────────────────

  async listTicketTypes(eventId: string) {
    const types = await this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return types.map((type) => describeType(type));
  }

  async createTicketType(eventId: string, dto: CreateTicketTypeDto) {
    await this.assertEventExists(eventId);
    assertNamed(dto.name, 'name');

    const limits = withDefaults(dto);
    const problems = ticketTypeChangeProblems(
      { ...limits, quantitySold: 0, quantityReserved: 0 },
      {},
    );
    if (problems.length > 0) throw new BadRequestException(problems);

    const last = await this.prisma.ticketType.findFirst({
      where: { eventId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const created = await this.prisma.ticketType.create({
      data: {
        eventId,
        name: dto.name as Prisma.InputJsonValue,
        description: (dto.description ?? {}) as Prisma.InputJsonValue,
        priceMinor: BigInt(dto.priceMinor),
        ...limits,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    return describeType(created);
  }

  /**
   * Changes a type, including its price.
   *
   * The capacity check here reads the row and then writes it, which on its
   * own would race a concurrent checkout. It is the explanation, not the
   * guarantee: the database CHECK on `quantityTotal >= quantitySold +
   * quantityReserved` is what actually refuses an oversell, and a concurrent
   * checkout that wins arrives here as a constraint error, turned into a 409.
   */
  async updateTicketType(eventId: string, typeId: string, dto: UpdateTicketTypeDto) {
    const current = await this.requireType(eventId, typeId);
    if (dto.name) assertNamed(dto.name, 'name');

    const change = {
      quantityTotal: dto.quantityTotal,
      minPerOrder: dto.minPerOrder,
      maxPerOrder: dto.maxPerOrder,
      salesStartAt: dto.salesStartAt ? new Date(dto.salesStartAt) : undefined,
      salesEndAt: dto.salesEndAt ? new Date(dto.salesEndAt) : undefined,
      priceMinor: dto.priceMinor === undefined ? undefined : BigInt(dto.priceMinor),
    };
    const problems = ticketTypeChangeProblems(current, change);
    if (problems.length > 0) throw new BadRequestException(problems);

    try {
      const updated = await this.prisma.ticketType.update({
        where: { id: typeId },
        data: {
          ...change,
          name: dto.name as Prisma.InputJsonValue | undefined,
          description: dto.description as Prisma.InputJsonValue | undefined,
          isActive: dto.isActive,
        },
      });
      return describeType(updated);
    } catch (error) {
      if (isCheckViolation(error)) {
        throw new ConflictException(
          'More tickets were sold or held while you were editing; capacity cannot go that low now',
        );
      }
      throw error;
    }
  }

  /**
   * Deletes a type nothing has been sold against; otherwise says to
   * deactivate it, because its tickets and order lines point at it.
   */
  async deleteTicketType(eventId: string, typeId: string) {
    const current = await this.requireType(eventId, typeId);

    if (!canDeleteTicketType(current)) {
      throw new ConflictException(
        `${current.quantitySold} sold and ${current.quantityReserved} held against this type. ` +
          'Set isActive to false to stop selling it instead.',
      );
    }

    // Conditioned again, so a checkout that reserves between the read and the
    // delete is not left holding seats against a type that no longer exists.
    const deleted = await this.prisma.ticketType.deleteMany({
      where: { id: typeId, quantitySold: 0, quantityReserved: 0 },
    });
    if (deleted.count === 0) {
      throw new ConflictException('Someone started buying this just now; deactivate it instead');
    }
    return { ok: true as const };
  }

  // ── the listing ──────────────────────────────────────────────────────

  async getListing(eventId: string) {
    const listing = await this.prisma.eventListing.findUnique({ where: { eventId } });
    if (!listing) throw new NotFoundException('This event has no public listing yet');
    return listing;
  }

  /**
   * Creates or edits the listing. Omitted fields are left as they are.
   *
   * The slug is generated from the headline when not given, by the same rule
   * as invitation slugs — readable where the text is Latin, `event-<random>`
   * where it is Armenian, because Armenian contains nothing URL-safe.
   */
  async upsertListing(eventId: string, dto: UpsertListingDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, listing: { select: { id: true } } },
    });
    if (!event) throw new NotFoundException(`No event ${eventId}`);

    const data = {
      headline: dto.headline as Prisma.InputJsonValue | undefined,
      summary: dto.summary as Prisma.InputJsonValue | undefined,
      body: dto.body as Prisma.InputJsonValue | undefined,
      categories: dto.categories,
      ogTitle: dto.ogTitle as Prisma.InputJsonValue | undefined,
      ogDescription: dto.ogDescription as Prisma.InputJsonValue | undefined,
      isIndexable: dto.isIndexable,
    };

    try {
      return await this.prisma.eventListing.upsert({
        where: { eventId },
        create: {
          eventId,
          slug: dto.slug ?? listingSlug(event.title),
          ...data,
        },
        update: { ...data, slug: dto.slug },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`The address "${dto.slug ?? ''}" is already taken`);
      }
      throw error;
    }
  }

  /**
   * Makes the listing public.
   *
   * Refused for a PRIVATE event, which must never be listed — change its
   * visibility first, deliberately. Also marks the event PUBLISHED, which is
   * what the public browse filters on; without it a published listing would
   * still never appear.
   */
  async publishListing(eventId: string) {
    const listing = await this.prisma.eventListing.findUnique({
      where: { eventId },
      select: {
        headline: true,
        event: { select: { visibility: true, startsAt: true } },
      },
    });
    if (!listing) throw new NotFoundException('Create the listing before publishing it');

    const problems = listingPublishProblems(listing, new Date());
    if (problems.length > 0) throw new BadRequestException(problems);

    return this.prisma.$transaction(async (tx) => {
      await tx.event.updateMany({
        where: { id: eventId, status: EventStatus.DRAFT },
        data: { status: EventStatus.PUBLISHED },
      });
      return tx.eventListing.update({
        where: { eventId },
        data: { publishedAt: new Date() },
      });
    });
  }

  /** Takes it down. Tickets already sold are unaffected. */
  async unpublishListing(eventId: string) {
    await this.getListing(eventId);
    return this.prisma.eventListing.update({
      where: { eventId },
      data: { publishedAt: null },
    });
  }

  private async requireType(eventId: string, typeId: string) {
    const type = await this.prisma.ticketType.findFirst({ where: { id: typeId, eventId } });
    if (!type) throw new NotFoundException('No such ticket type on this event');
    return type;
  }

  private async assertEventExists(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException(`No event ${eventId}`);
  }
}

/** A new type's limits, with the defaults a host did not state filled in. */
function withDefaults(dto: CreateTicketTypeDto) {
  return {
    quantityTotal: dto.quantityTotal,
    minPerOrder: dto.minPerOrder ?? 1,
    maxPerOrder: dto.maxPerOrder ?? 10,
    salesStartAt: dto.salesStartAt ? new Date(dto.salesStartAt) : null,
    salesEndAt: dto.salesEndAt ? new Date(dto.salesEndAt) : null,
  };
}

/** Every reason a listing is not ready to go public. */
function listingPublishProblems(
  listing: { headline: Prisma.JsonValue; event: { visibility: EventVisibility; startsAt: Date } },
  now: Date,
): string[] {
  const problems: string[] = [];

  if (listing.event.visibility === EventVisibility.PRIVATE) {
    problems.push(
      'This event is private. Set its visibility to PUBLIC or UNLISTED first, deliberately',
    );
  }
  if (!hasAnyTranslation(listing.headline)) {
    problems.push('headline: give the listing a headline in at least one language');
  }
  if (listing.event.startsAt <= now) {
    problems.push('This event has already started');
  }
  return problems;
}

function hasAnyTranslation(value: Prisma.JsonValue): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).some((entry) => typeof entry === 'string' && entry.trim() !== '');
}

function assertNamed(value: Record<string, unknown>, field: string): void {
  if (!Object.values(value).some((entry) => typeof entry === 'string' && entry.trim() !== '')) {
    throw new BadRequestException(`${field}: give it a name in at least one language`);
  }
}

function listingSlug(title: string): string {
  const base = slugify(title);
  const tail = randomBytes(3).toString('hex');
  return base.length > 0 ? `${base}-${tail}` : `event-${tail}`;
}

function describeType(type: {
  id: string;
  name: Prisma.JsonValue;
  description: Prisma.JsonValue;
  priceMinor: bigint;
  currency: string;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  minPerOrder: number;
  maxPerOrder: number;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  isActive: boolean;
  sortOrder: number;
}) {
  return {
    id: type.id,
    name: type.name,
    description: type.description,
    priceMinor: type.priceMinor.toString(),
    currency: type.currency,
    quantityTotal: type.quantityTotal,
    sold: type.quantitySold,
    held: type.quantityReserved,
    // The figure a host actually watches.
    available: Math.max(0, type.quantityTotal - type.quantitySold - type.quantityReserved),
    minPerOrder: type.minPerOrder,
    maxPerOrder: type.maxPerOrder,
    salesStartAt: type.salesStartAt,
    salesEndAt: type.salesEndAt,
    isActive: type.isActive,
    sortOrder: type.sortOrder,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** A CHECK constraint refusing the write — here, capacity below what is taken. */
function isCheckViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  return /check constraint|23514/i.test(error.message);
}
