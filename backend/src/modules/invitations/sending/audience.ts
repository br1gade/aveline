import { MessageChannel, Prisma, PrismaClient } from '@prisma/client';
import { GuestChannelsService } from '../../communications/guest-channels.service';
import { normalizeAddress } from '../../communications/suppression.service';
import { GuestAddress } from './channel-preference';
import { REACHED_STATUSES } from './previous-attempts';
import { SendableHousehold } from './send-plan';

/**
 * The two questions every guest-facing sender asks before it writes to anyone:
 * which channels can carry this message, and which households, with every
 * address each guest can be reached at.
 *
 * Extracted on the third copy. The invitation sender and the reminder service
 * each carried identical versions of both, and RSVP confirmations needed them
 * too; three copies of "which channels have copy" is how one of them ends up
 * forgetting the template check and failing mid-send.
 */

/** A Prisma client or an open transaction, whichever the caller has. */
type Reader = Pick<PrismaClient, 'messageTemplate' | 'household' | 'suppression'>;

/**
 * Channels we can both send on and have copy for.
 *
 * Both halves are required. A configured transport with no template for this
 * message fails mid-send with "template not found" after some households have
 * already been written to; copy with no transport queues messages that can
 * only fail. Intersecting them means an organization that has written no
 * Telegram copy simply keeps getting email, with nothing to configure.
 */
export async function channelsWithCopy(
  prisma: Reader,
  organizationId: string,
  templateKey: string,
  configured: readonly MessageChannel[],
): Promise<MessageChannel[]> {
  const templates = await prisma.messageTemplate.findMany({
    where: {
      key: templateKey,
      isActive: true,
      OR: [{ organizationId }, { organizationId: null }],
    },
    select: { channel: true },
  });

  const withCopy = new Set(templates.map((template) => template.channel));
  return configured.filter((channel) => withCopy.has(channel));
}

/**
 * Households matching `where`, with every way each guest can be reached.
 *
 * One shape of query so every sender reads the same fields: a sender that
 * forgot `channels` would never choose Telegram, and one that forgot
 * `anonymizedAt` would write to someone who asked to be erased.
 */
export async function loadSendableHouseholds(
  prisma: Reader,
  guestChannels: GuestChannelsService,
  where: Prisma.HouseholdWhereInput,
): Promise<SendableHousehold[]> {
  const households = await prisma.household.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      guests: {
        orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          isPrimary: true,
          locale: true,
          token: true,
          anonymizedAt: true,
          channels: { select: { channel: true, address: true, optedInAt: true } },
        },
      },
      event: { select: { organizationId: true } },
    },
  });

  const withAddresses = households.map(({ event, ...household }) => ({
    ...household,
    organizationId: event.organizationId,
    guests: household.guests.map((guest) => ({ ...guest, addresses: guestChannels.addressesFor(guest) })),
  }));
  const suppressed = await suppressedAmong(prisma, withAddresses);

  return withAddresses.map(({ organizationId, ...household }) => ({
    ...household,
    guests: household.guests.map((guest) => ({
      ...guest,
      addresses: guest.addresses.map((address) => ({
        ...address,
        isSuppressed: suppressed.has(suppressionKey(organizationId, address.channel, address.address)),
      })),
    })),
  }));
}

/**
 * Which of these households' addresses are suppressed for their organization,
 * in one query — so a sender can prefer the guest's other channels.
 */
async function suppressedAmong(
  prisma: Reader,
  households: { organizationId: string; guests: { addresses?: GuestAddress[] }[] }[],
): Promise<Set<string>> {
  const addresses = households.flatMap((household) =>
    household.guests.flatMap((guest) => (guest.addresses ?? []).map((address) => normalizeAddress(address.channel, address.address))),
  );
  if (addresses.length === 0) return new Set();

  const organizationIds = [...new Set(households.map((household) => household.organizationId))];
  const rows = await prisma.suppression.findMany({
    where: { address: { in: [...new Set(addresses)] }, OR: [{ organizationId: null }, { organizationId: { in: organizationIds } }] },
    select: { organizationId: true, channel: true, address: true },
  });
  // A platform-wide row applies to every organization these households are in.
  return new Set(
    rows.flatMap((row) =>
      (row.organizationId === null ? organizationIds : [row.organizationId]).map((organizationId) =>
        suppressionKey(organizationId, row.channel, row.address),
      ),
    ),
  );
}

function suppressionKey(organizationId: string, channel: MessageChannel, address: string): string {
  return `${organizationId}|${channel}|${normalizeAddress(channel, address)}`;
}

/**
 * "This guest was invited": an invitation reached them or is on its way.
 *
 * The same rule `hasReachedGuest` applies before resending. Reminders used to
 * count any invitation message at all — failed, bounced, suppressed — so a
 * guest whose invitation never arrived was chased about it.
 */
export const INVITATION_REACHED: Prisma.MessageListRelationFilter = {
  some: { templateKey: 'invitation.send', status: { in: REACHED_STATUSES } },
};

/** How many households hold the invitation — the audience for a change notice. */
export function countInvitedHouseholds(prisma: Reader, eventId: string): Promise<number> {
  return prisma.household.count({
    where: { eventId, guests: { some: { messages: INVITATION_REACHED } } },
  });
}
