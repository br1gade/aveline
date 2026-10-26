import { EnquiryPrivacySubject, eraseEnquirySubjects } from '../sales/enquiry-privacy';
import { eraseContributions } from '../guest-contributions/contribution-privacy';
import { revokeSubjectExports } from '../exports/export-privacy';
import { attendeeSubject, eraseAttendees, lockSubjectOrders } from '../ticketing/attendee-privacy';
import { MessageChannel, MessageStatus, Prisma, SuppressionReason } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { addressFingerprint } from '../communications/address-form';
import { urlsOf } from '../media/media.service';
import {
  ERASED_NAME,
  ERASED_RSVP_FIELDS,
  anonymisedGuestFields,
  isNamedAfter,
  nextHouseholdName,
} from './anonymisation';

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
 * What survives is deliberate — the household (renamed if its name still
 * names them), the seat, whether they came, and a ticket order's amount — so
 * a headcount the caterer was paid for, or a financial record, does not
 * change. Dietary tags and answers go (decided 9 October 2026).
 *
 * Postgres is all one transaction. What lives elsewhere — the signature
 * files in storage, the person's traces in the Mongo audit trail and view
 * analytics — is returned as `afterwards`, for the caller to clear once the
 * transaction has committed.
 */
type Tx = Prisma.TransactionClient;

export const ERASED = '[erased]';

/** The request is stored lower-cased; rows may not be. */
export function sameAddress(email: string) {
  return { equals: email, mode: Prisma.QueryMode.insensitive };
}

interface ErasedGuest {
  id: string;
  firstName: string;
  lastName: string | null;
  householdId: string;
  organizationId: string;
}

interface KnownAddress {
  channel: MessageChannel;
  address: string;
}

export async function eraseSubject(tx: Tx, email: string, now: Date, enquirySubject?: EnquiryPrivacySubject) {
  await revokeSubjectExports(tx, email, now);
  const enquiryCounts = await eraseEnquirySubjects(tx, { subject: enquirySubject ?? { email, verifiedContactIds: [] }, now });
  await lockSubjectOrders(tx, email);
  const { guests, addresses } = await findGuests(tx, email);
  const guestIds = guests.map((guest) => guest.id);
  const fileUrls = await signatureFiles(tx, guestIds);
  const buyerOrganizationIds = await organizationsSoldTo(tx, email);

  const ticketAttendeesAnonymised = await eraseAttendees(tx, { email, guestIds, now });
  if (guestIds.length) await tx.$queryRaw`SELECT id FROM households WHERE id IN (SELECT "householdId" FROM guests WHERE id IN (${Prisma.join(guestIds)})) ORDER BY id FOR UPDATE`;
  const privateContributions = await eraseContributions(tx, guestIds, now);
  await eraseGuests(tx, guestIds, now);
  const householdsRenamed = await renameHouseholdsNamedAfter(tx, guests);
  const ticketOrdersAnonymised = await eraseTicketHolders(tx, email, guestIds);
  const messagesRedacted = await redactMessages(tx, email, guestIds);
  const suppressionsHashed = await hashSuppressions(tx, addresses);
  await rememberErasure(tx, [...guests.map((guest) => guest.organizationId), ...buyerOrganizationIds], addresses);
  const invitesWithdrawn = await withdrawInvites(tx, email);
  const closedUserId = await closeAccount(tx, email, now);

  return {
    counts: {
      ...privateContributions,
      ...enquiryCounts,
      guestsAnonymised: guestIds.length,
      ticketAttendeesAnonymised,
      householdsRenamed,
      ticketOrdersAnonymised,
      messagesRedacted,
      suppressionsHashed,
      invitesWithdrawn,
      accountsClosed: closedUserId ? 1 : 0,
    },
    afterwards: { guestIds, fileUrls, userId: closedUserId },
  };
}

/** The guest rows, and every address they reached the person at — collected before the rows are cleared. */
async function findGuests(tx: Tx, email: string): Promise<{ guests: ErasedGuest[]; addresses: KnownAddress[] }> {
  const rows = await tx.guest.findMany({
    where: { anonymizedAt: null, OR: [{ email: sameAddress(email) }, { ticket: { attendee: attendeeSubject(email) } }] },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      householdId: true,
      phone: true,
      event: { select: { organizationId: true } },
      channels: { select: { channel: true, address: true } },
    },
  });
  const addresses: KnownAddress[] = [
    { channel: MessageChannel.EMAIL, address: email },
    ...rows.flatMap((row) => [
      ...(row.phone
        ? [MessageChannel.SMS, MessageChannel.WHATSAPP].map((channel) => ({ channel, address: row.phone as string }))
        : []),
      ...row.channels,
    ]),
  ];
  const guests = rows.map(({ phone: _phone, channels: _channels, event, ...guest }) => ({
    ...guest,
    organizationId: event.organizationId,
  }));
  return { guests, addresses };
}

/** A drawn signature is an image of them. The rows go here; the files after commit. */
async function signatureFiles(tx: Tx, guestIds: string[]): Promise<string[]> {
  const assets = await tx.mediaAsset.findMany({
    where: { rsvpSignatures: { some: { guestId: { in: guestIds } } } },
    select: { url: true, variants: true },
  });
  return assets.flatMap(urlsOf);
}

async function organizationsSoldTo(tx: Tx, email: string): Promise<string[]> {
  const orders = await tx.ticketOrder.findMany({
    where: { OR: [{ buyerEmail: sameAddress(email) }, { attendees: { some: attendeeSubject(email) } }] },
    select: { event: { select: { organizationId: true } } },
  });
  return orders.map((order) => order.event.organizationId);
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
  // Every answer to the host's questions, choices included: an option can be
  // as revealing as a tag ("kosher meal").
  await tx.rsvpAnswer.deleteMany({ where: { rsvp: { guestId: { in: guestIds } } } });
  await tx.mediaAsset.deleteMany({ where: { rsvpSignatures: { some: { guestId: { in: guestIds } } } } });
  await tx.guestChannel.deleteMany({ where: { guestId: { in: guestIds } } });
  await tx.deviceToken.deleteMany({ where: { guestId: { in: guestIds } } });
}

/**
 * A household whose name still names them becomes "Household" and a number
 * (decided 10 October 2026, D20): "Anna & Davit" beside an anonymised row is
 * Anna, named again. A family name others still carry stays theirs; notes go
 * only once nobody is left, since until then they are about the others too.
 */
async function renameHouseholdsNamedAfter(tx: Tx, guests: ErasedGuest[]): Promise<number> {
  const households = await tx.household.findMany({
    where: { id: { in: [...new Set(guests.map((guest) => guest.householdId))] } },
    select: { id: true, name: true, eventId: true, guests: { where: { anonymizedAt: null }, select: { lastName: true } } },
  });
  let renamed = 0;
  for (const household of households) {
    const erasedHere = guests.filter((guest) => guest.householdId === household.id);
    if (!isNamedAfter(household.name, erasedHere, household.guests)) continue;
    const numbered = await tx.household.findMany({
      where: { eventId: household.eventId, name: { startsWith: 'Household ' } },
      select: { name: true },
    });
    await tx.household.update({
      where: { id: household.id },
      data: {
        name: nextHouseholdName(numbered.map((row) => row.name)),
        ...(household.guests.length === 0 ? { notes: null } : {}),
      },
    });
    renamed += 1;
  }
  return renamed;
}

/** A paid order keeps its amount — financial records have their own retention — and loses the person. */
async function eraseTicketHolders(tx: Tx, email: string, guestIds: string[]): Promise<number> {
  const orders = await tx.ticketOrder.updateMany({
    where: { buyerEmail: sameAddress(email) },
    data: {
      requestFingerprint: null,
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

/**
 * Their do-not-contact records are kept, hashed (decided 10 October 2026,
 * D15). Deleted, a person who complained could be written to again the
 * moment a host re-added them; kept as they were, they hold the address.
 * A row whose hash is already recorded in the same scope is simply dropped.
 */
async function hashSuppressions(tx: Tx, addresses: KnownAddress[]): Promise<number> {
  const rows = await tx.suppression.findMany({
    where: { OR: addresses.map(({ address }) => ({ address: sameAddress(address) })) },
    select: { id: true, organizationId: true, channel: true, address: true },
  });
  for (const row of rows) {
    const fingerprint = addressFingerprint(row.channel, row.address);
    const twin = await tx.suppression.findFirst({
      where: { organizationId: row.organizationId, channel: row.channel, address: fingerprint },
      select: { id: true },
    });
    await (twin
      ? tx.suppression.delete({ where: { id: row.id } })
      : tx.suppression.update({ where: { id: row.id }, data: { address: fingerprint, notes: null } }));
  }
  return rows.length;
}

/**
 * Every organization that held them keeps a hashed ERASED record of each
 * address (decided 10 October 2026, D21), so re-importing the old guest file
 * cannot bring them back and nothing can be sent to them. Other hosts are
 * untouched: inviting them would be a new relationship.
 */
async function rememberErasure(tx: Tx, organizationIds: string[], addresses: KnownAddress[]): Promise<void> {
  const fingerprints = addresses.map(({ channel, address }) => ({ channel, address: addressFingerprint(channel, address) }));
  const rows = [...new Set(organizationIds)].flatMap((organizationId) =>
    fingerprints.map((fingerprint) => ({ organizationId, ...fingerprint, reason: SuppressionReason.ERASED })),
  );
  if (rows.length === 0) return;
  await tx.suppression.createMany({ data: rows, skipDuplicates: true });
  // An older hashed unsubscribe in the same place becomes ERASED, which a host cannot lift.
  await tx.suppression.updateMany({
    where: {
      organizationId: { in: [...new Set(organizationIds)] },
      address: { in: fingerprints.map((fingerprint) => fingerprint.address) },
    },
    data: { reason: SuppressionReason.ERASED },
  });
}

/** Invitations to join a team are addressed to them; accepting one after erasure would recreate them. */
async function withdrawInvites(tx: Tx, email: string): Promise<number> {
  const [organization, event] = await Promise.all([
    tx.organizationInvite.deleteMany({ where: { email: sameAddress(email) } }),
    tx.eventInvite.deleteMany({ where: { email: sameAddress(email) } }),
  ]);
  return organization.count + event.count;
}

/**
 * Their account, if they had one. Closed and anonymised rather than deleted:
 * it may own an organization whose events other people still rely on.
 */
async function closeAccount(tx: Tx, email: string, now: Date): Promise<string | null> {
  const user = await tx.user.findFirst({ where: { email: sameAddress(email) }, select: { id: true } });
  if (!user) return null;

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
  // Where and on what they signed in is about them too.
  await tx.session.updateMany({ where: { userId: user.id }, data: { ipAddress: null, userAgent: null } });
  await tx.verificationToken.deleteMany({ where: { userId: user.id } });
  await tx.deviceToken.deleteMany({ where: { userId: user.id } });
  return user.id;
}
