import { MessageStatus, Prisma, QuestionType } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ERASED_NAME, ERASED_RSVP_FIELDS, anonymisedGuestFields } from './anonymisation';

/**
 * Everything one erasure touches, as steps inside one transaction.
 *
 * The first version reached the guest row it was designed around and little
 * else: after an erasure that reported success, the person's account still
 * signed in, their own words survived in custom answers, their Telegram chat
 * and every message sent to it remained, and any row holding their address
 * with different capitals was missed entirely. Each step below closes one of
 * those.
 *
 * What survives is still deliberate — household, seat, response status,
 * dietary tags, menu choices and a ticket order's amount — so a headcount the
 * caterer was paid for, or a financial record, does not change.
 */
type Tx = Prisma.TransactionClient;

export const ERASED = '[erased]';

/** Answers a guest wrote in their own words. Choices only count. */
const OWN_WORDS: QuestionType[] = [QuestionType.TEXT, QuestionType.LONG_TEXT, QuestionType.SIGNATURE];

/** The request is stored lower-cased; rows may not be. */
export function sameAddress(email: string) {
  return { equals: email, mode: Prisma.QueryMode.insensitive };
}

export async function eraseSubject(tx: Tx, email: string, now: Date) {
  const guests = await tx.guest.findMany({
    where: { email: sameAddress(email), anonymizedAt: null },
    select: { id: true, phone: true, channels: { select: { address: true } } },
  });
  const guestIds = guests.map((guest) => guest.id);
  // Collected before the rows are cleared: these are addresses too.
  const addresses = [email, ...guests.flatMap((g) => [g.phone, ...g.channels.map((c) => c.address)])].filter(
    (address): address is string => Boolean(address),
  );

  await eraseGuests(tx, guestIds, now);
  const ticketOrdersAnonymised = await eraseTicketHolders(tx, email, guestIds);
  const messagesRedacted = await redactMessages(tx, email, guestIds);
  const suppressionsRemoved = await forgetSuppressions(tx, addresses);
  const accountsClosed = await closeAccount(tx, email, now);

  return {
    guestsAnonymised: guestIds.length,
    ticketOrdersAnonymised,
    messagesRedacted,
    suppressionsRemoved,
    accountsClosed,
  };
}

async function eraseGuests(tx: Tx, guestIds: string[], now: Date): Promise<void> {
  for (const guestId of guestIds) {
    // A fresh token each: the old link identifies them and would still open their RSVP.
    await tx.guest.update({
      where: { id: guestId },
      data: anonymisedGuestFields(randomBytes(16).toString('hex'), now),
    });
  }

  await tx.rsvp.updateMany({ where: { guestId: { in: guestIds } }, data: ERASED_RSVP_FIELDS });
  await tx.rsvpAnswer.deleteMany({
    where: { rsvp: { guestId: { in: guestIds } }, question: { type: { in: OWN_WORDS } } },
  });
  // A drawn signature is an image of them; the row goes, which unlinks it.
  await tx.mediaAsset.deleteMany({ where: { rsvpSignatures: { some: { guestId: { in: guestIds } } } } });
  await tx.guestChannel.deleteMany({ where: { guestId: { in: guestIds } } });
  await tx.deviceToken.deleteMany({ where: { guestId: { in: guestIds } } });
}

/** A paid order keeps its amount — financial records have their own retention — and loses the person. */
async function eraseTicketHolders(tx: Tx, email: string, guestIds: string[]): Promise<number> {
  const orders = await tx.ticketOrder.updateMany({
    where: { buyerEmail: sameAddress(email) },
    data: {
      buyerName: ERASED_NAME,
      buyerEmail: `erased-${randomBytes(8).toString('hex')}@erased.invalid`,
      buyerPhone: null,
    },
  });
  await tx.ticket.updateMany({
    where: { OR: [{ holderEmail: sameAddress(email) }, { guestId: { in: guestIds } }] },
    data: { holderName: null, holderEmail: null },
  });
  return orders.count;
}

/**
 * Every message sent to them, on any channel. That a message was sent is a
 * record of processing we must be able to show; what it said and where it
 * went are theirs. Anything still waiting to go is stopped first, or the
 * outbox would deliver it to an address it no longer knows.
 */
async function redactMessages(tx: Tx, email: string, guestIds: string[]): Promise<number> {
  const theirs: Prisma.MessageWhereInput = {
    OR: [{ toAddress: sameAddress(email) }, { guestId: { in: guestIds } }],
  };

  await tx.message.updateMany({
    where: { ...theirs, status: MessageStatus.QUEUED },
    data: { status: MessageStatus.FAILED, failureReason: 'Recipient’s data was erased' },
  });
  const redacted = await tx.message.updateMany({
    where: theirs,
    data: { subject: null, body: ERASED, toAddress: ERASED, providerParams: [] },
  });
  return redacted.count;
}

/** A suppression holds the address itself, which is no longer ours to keep. */
async function forgetSuppressions(tx: Tx, addresses: string[]): Promise<number> {
  const removed = await tx.suppression.deleteMany({
    where: { OR: addresses.map((address) => ({ address: sameAddress(address) })) },
  });
  return removed.count;
}

/**
 * Their account, if they had one. Closed and anonymised rather than deleted:
 * it may own an organization whose events other people still rely on.
 */
async function closeAccount(tx: Tx, email: string, now: Date): Promise<number> {
  const user = await tx.user.findFirst({ where: { email: sameAddress(email) }, select: { id: true } });
  if (!user) return 0;

  await tx.user.update({
    where: { id: user.id },
    data: {
      email: `erased-${randomBytes(8).toString('hex')}@erased.invalid`,
      name: ERASED_NAME,
      passwordHash: null,
      isActive: false,
      deletedAt: now,
    },
  });
  await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
  await tx.verificationToken.deleteMany({ where: { userId: user.id } });
  await tx.deviceToken.deleteMany({ where: { userId: user.id } });
  return 1;
}
