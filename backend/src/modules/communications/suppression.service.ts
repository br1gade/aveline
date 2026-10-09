import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageChannel, Prisma, SuppressionReason } from '@prisma/client';
import { normalizeEmailAddress } from '../../common/address';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Who must not be contacted.
 *
 * Two scopes, and the difference matters legally. A row with no organization
 * is global: a hard bounce or a spam complaint means that address is never
 * written to again by anyone, because continuing to send damages deliverability
 * for every customer. A row with an organization is an ordinary unsubscribe
 * from one host's events, and says nothing about the others.
 */
@Injectable()
export class SuppressionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whether this address is suppressed for this sender.
   *
   * One query covering both scopes: a global row or this organization's row.
   * Checking them separately would double the cost of every send for no gain.
   */
  async isSuppressed(
    channel: MessageChannel,
    address: string,
    organizationId: string | null,
  ): Promise<boolean> {
    const found = await this.prisma.suppression.findFirst({
      where: {
        channel,
        address: normalizeAddress(channel, address),
        // Platform mail is only ever stopped by a global suppression: a
        // password reset must not be blocked because one organization
        // unsubscribed that address from their own events.
        OR: organizationId === null
          ? [{ organizationId: null }]
          : [{ organizationId: null }, { organizationId }],
      },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * What stops this organization reaching someone: its own suppressions, and
   * the platform-wide ones that touch its own guests. Every platform-wide
   * suppression used to be listed to every host — every bounced or
   * complaining address on the platform, including other customers' guests.
   */
  async list(organizationId: string) {
    const addresses = await this.guestAddresses(organizationId);
    const rows = await this.prisma.suppression.findMany({
      where: { OR: [{ organizationId }, { organizationId: null, address: { in: addresses } }] },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      address: row.address,
      reason: row.reason,
      // A host should see that an address is beyond their control before they
      // ask support why removing it did not work.
      scope: row.organizationId === null ? ('GLOBAL' as const) : ('ORGANIZATION' as const),
      notes: row.notes,
      createdAt: row.createdAt,
    }));
  }

  /** Every email and phone on this organization's guests, as suppressions store them. */
  private async guestAddresses(organizationId: string): Promise<string[]> {
    const guests = await this.prisma.guest.findMany({
      where: { event: { organizationId }, OR: [{ email: { not: null } }, { phone: { not: null } }] },
      select: { email: true, phone: true },
    });
    return [
      ...new Set(
        guests.flatMap((guest) => [
          guest.email ? normalizeAddress(MessageChannel.EMAIL, guest.email) : null,
          guest.phone,
        ]).filter((address): address is string => address !== null),
      ),
    ];
  }

  /**
   * Suppresses an address. Idempotent: suppressing twice is not an error,
   * because the caller's intent is already satisfied.
   */
  async suppress(input: {
    organizationId: string | null;
    channel: MessageChannel;
    address: string;
    reason: SuppressionReason;
    notes?: string;
  }) {
    const address = normalizeAddress(input.channel, input.address);

    // A later, stronger reason wins: an unsubscribe followed by a complaint
    // must not stay recorded as a mere unsubscribe.
    if (input.organizationId === null) {
      await this.upsertGlobal(input.channel, address, input.reason, input.notes);
    } else {
      await this.prisma.suppression.upsert({
        where: {
          organizationId_channel_address: {
            organizationId: input.organizationId,
            channel: input.channel,
            address,
          },
        },
        create: {
          organizationId: input.organizationId,
          channel: input.channel,
          address,
          reason: input.reason,
          notes: input.notes ?? null,
        },
        update: { reason: input.reason, notes: input.notes ?? undefined },
      });
    }

    return this.prisma.suppression.findFirstOrThrow({
      where: { organizationId: input.organizationId, channel: input.channel, address },
    });
  }

  /**
   * A global row cannot go through Prisma's `upsert`.
   *
   * Its compound unique includes the nullable `organizationId`, which Prisma
   * will not accept as null and which Postgres would not match anyway. The
   * conflict target here is the partial unique index that covers exactly these
   * rows, so two concurrent bounce reports collapse into one instead of racing.
   */
  private async upsertGlobal(
    channel: MessageChannel,
    address: string,
    reason: SuppressionReason,
    notes?: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "suppressions" ("id", "organizationId", "channel", "address", "reason", "notes", "createdAt")
           VALUES (gen_random_uuid()::text, NULL, ${channel}::"MessageChannel", ${address},
                   ${reason}::"SuppressionReason", ${notes ?? null}, NOW())
      ON CONFLICT ("channel", "address") WHERE "organizationId" IS NULL
        DO UPDATE SET "reason" = ${reason}::"SuppressionReason",
                      "notes" = COALESCE(${notes ?? null}, "suppressions"."notes")
    `;
  }

  /**
   * Removes a suppression this organization owns.
   *
   * A global suppression cannot be lifted here. A hard bounce or a complaint
   * is not one host's to overrule, and letting them would let one customer
   * damage delivery for every other.
   */
  async unsuppress(organizationId: string, suppressionId: string) {
    const row = await this.prisma.suppression.findUnique({ where: { id: suppressionId } });
    if (!row) throw new NotFoundException('No such suppression');

    if (row.organizationId === null) {
      throw new ConflictException(
        'This address is suppressed platform-wide after a bounce or complaint and cannot be removed here',
      );
    }
    if (row.organizationId !== organizationId) throw new NotFoundException('No such suppression');

    await this.prisma.suppression.delete({ where: { id: suppressionId } });
    return { ok: true as const };
  }
}

/**
 * Email addresses are case-insensitive in practice, so they are stored and
 * matched lower-cased — otherwise `Ani@x.am` would slip past a suppression
 * recorded for `ani@x.am`. Phone numbers and chat handles are left as given,
 * because normalising them correctly needs a region and guessing wrong would
 * suppress the wrong person.
 */
function normalizeAddress(channel: MessageChannel, address: string): string {
  return channel === MessageChannel.EMAIL
    ? normalizeEmailAddress(address)
    : address.trim();
}

export type SuppressionRow = Prisma.SuppressionGetPayload<object>;
