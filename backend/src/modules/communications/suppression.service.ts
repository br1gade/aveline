import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageChannel, Prisma, SuppressionReason } from '@prisma/client';
import { isFingerprint, normalizeAddress, storedForms } from './address-form';
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
/** What a host sees for an erased person's row. */
const ERASED_ADDRESS = '[erased]';

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
        address: { in: storedForms(channel, address) },
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
   * Which of these addresses are suppressed for this sender, in one query —
   * for a send of hundreds, where asking one by one was a query a guest.
   * Keys are `channel|address`, the address as normalised.
   */
  async suppressedAmong(organizationId: string | null, entries: { channel: MessageChannel; address: string }[]): Promise<Set<string>> {
    const plainByForm = new Map<string, string>();
    for (const { channel, address } of entries) {
      const [plain, hashed] = storedForms(channel, address);
      plainByForm.set(plain, plain).set(hashed, plain);
    }
    if (plainByForm.size === 0) return new Set();

    const rows = await this.prisma.suppression.findMany({
      where: {
        address: { in: [...plainByForm.keys()] },
        OR: organizationId === null ? [{ organizationId: null }] : [{ organizationId: null }, { organizationId }],
      },
      select: { channel: true, address: true },
    });
    return new Set(rows.map((row) => `${row.channel}|${plainByForm.get(row.address) ?? row.address}`));
  }

  /**
   * What stops this organization reaching someone: its own suppressions, and
   * the platform-wide ones that touch its own guests. Every platform-wide
   * suppression used to be listed to every host — every bounced or
   * complaining address on the platform, including other customers' guests.
   */
  async list(organizationId: string) {
    const plainByForm = await this.guestAddressForms(organizationId);
    const rows = await this.prisma.suppression.findMany({
      where: { OR: [{ organizationId }, { organizationId: null, address: { in: [...plainByForm.keys()] } }] },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      // A hashed row shows the guest address it matches, if the host has one;
      // otherwise it is a person who was erased, and stays unreadable.
      address: plainByForm.get(row.address) ?? (isFingerprint(row.address) ? ERASED_ADDRESS : row.address),
      reason: row.reason,
      // A host should see that an address is beyond their control before they
      // ask support why removing it did not work.
      scope: row.organizationId === null ? ('GLOBAL' as const) : ('ORGANIZATION' as const),
      notes: row.notes,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Every email and phone on this organization's guests, keyed by each form a
   * suppression may store it in, pointing back at the address itself.
   */
  private async guestAddressForms(organizationId: string): Promise<Map<string, string>> {
    const guests = await this.prisma.guest.findMany({
      where: { event: { organizationId }, OR: [{ email: { not: null } }, { phone: { not: null } }] },
      select: { email: true, phone: true },
    });
    const plainByForm = new Map<string, string>();
    for (const guest of guests) {
      const known: [MessageChannel, string | null][] = [[MessageChannel.EMAIL, guest.email], [MessageChannel.SMS, guest.phone]];
      for (const [channel, address] of known) {
        if (!address) continue;
        const [plain, hashed] = storedForms(channel, address);
        plainByForm.set(plain, plain).set(hashed, plain);
      }
    }
    return plainByForm;
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
  }, transaction?: Prisma.TransactionClient) {
    const database = transaction ?? this.prisma;
    const address = normalizeAddress(input.channel, input.address);

    // A later, stronger reason wins: an unsubscribe followed by a complaint
    // must not stay recorded as a mere unsubscribe.
    if (input.organizationId === null) {
      await this.upsertGlobal({ ...input, address }, database);
    } else {
      await database.suppression.upsert({
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

    return database.suppression.findFirstOrThrow({
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
    input: { channel: MessageChannel; address: string; reason: SuppressionReason; notes?: string },
    database: Prisma.TransactionClient | PrismaService,
  ): Promise<void> {
    const { channel, address, reason, notes } = input;
    const priority: Record<SuppressionReason, number> = { UNSUBSCRIBED: 1, MANUAL: 2, HARD_BOUNCE: 3, COMPLAINT: 4, ERASED: 5 };
    await database.$executeRaw`
      INSERT INTO "suppressions" ("id", "organizationId", "channel", "address", "reason", "notes", "createdAt")
           VALUES (gen_random_uuid()::text, NULL, ${channel}::"MessageChannel", ${address},
                   ${reason}::"SuppressionReason", ${notes ?? null}, NOW())
      ON CONFLICT ("channel", "address") WHERE "organizationId" IS NULL
        DO UPDATE SET "reason" = ${reason}::"SuppressionReason",
                      "notes" = COALESCE(${notes ?? null}, "suppressions"."notes")
      WHERE array_position(ARRAY['UNSUBSCRIBED','MANUAL','HARD_BOUNCE','COMPLAINT','ERASED'], "suppressions"."reason"::text) <= ${priority[reason]}
    `;
  }

  /**
   * Lifts every suppression of a chat the guest has just opened again.
   *
   * Only for a channel where the recipient's own action proves consent:
   * starting or unblocking a Telegram bot is something only the chat's owner
   * can do. A host can never reach this; an email bounce is never lifted by it.
   */
  async liftAfterOptIn(channel: typeof MessageChannel.TELEGRAM, address: string): Promise<void> {
    await this.prisma.suppression.deleteMany({ where: { channel, address: { in: storedForms(channel, address) } } });
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
    if (row.reason === SuppressionReason.ERASED) {
      throw new ConflictException('This person asked for their data to be erased; they cannot be contacted again');
    }

    await this.prisma.suppression.delete({ where: { id: suppressionId } });
    return { ok: true as const };
  }
}

export { normalizeAddress } from './address-form';

export type SuppressionRow = Prisma.SuppressionGetPayload<object>;
