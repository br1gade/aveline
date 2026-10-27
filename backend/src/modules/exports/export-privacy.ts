import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { attendeeSubject } from '../ticketing/attendee-privacy';

export function exportSubjectFingerprint(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export async function lockExportPrivacy(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`INSERT INTO export_privacy_fences (id,revision) VALUES ('exports',0) ON CONFLICT DO NOTHING`;
  // REPEATABLE READ rejects a row changed while waiting: retry with fresh inputs.
  await tx.$queryRaw`SELECT id FROM export_privacy_fences WHERE id = 'exports' FOR SHARE`;
}

/** Must run before other erasure locks, so captures cannot miss an in-flight erasure. */
export async function revokeSubjectExports(tx: Prisma.TransactionClient, email: string, now: Date): Promise<void> {
  await tx.exportPrivacyFence.upsert({ where: { id: 'exports' }, create: { id: 'exports', revision: 1 }, update: { revision: { increment: 1 } } });
  const fingerprint = exportSubjectFingerprint(email);
  const events = await tx.event.findMany({ where: { OR: [
    { guests: { some: { email: { equals: email, mode: 'insensitive' } } } },
    { ticketOrders: { some: { OR: [{ buyerEmail: { equals: email, mode: 'insensitive' } }, { attendees: { some: attendeeSubject(email) } }] } } },
    { tickets: { some: { holderEmail: { equals: email, mode: 'insensitive' } } } },
    { exportSnapshots: { some: { subjects: { some: { fingerprint } } } } },
  ] }, select: { id: true } });
  const eventIds = events.map((event) => event.id);
  // Conservatively invalidate all existing files for affected events; redacted
  // operational sheets can still contain names, allergies or free-text answers.
  await tx.exportSnapshot.updateMany({ where: { eventId: { in: eventIds }, revokedAt: null }, data: {
    revokedAt: now, status: 'FAILED', failureReason: 'SUBJECT_ERASED', leaseOwner: null, leaseUntil: null,
  } });
  await tx.exportArtifact.updateMany({ where: { snapshot: { eventId: { in: eventIds } } }, data: { cleanupAfter: now } });
  await tx.exportSnapshotSubject.deleteMany({ where: { snapshot: { eventId: { in: eventIds }, revokedAt: { not: null } } } });
}

export async function rememberExportSubjects(tx: Prisma.TransactionClient, snapshot: { id: string; eventId: string }): Promise<void> {
  const [guests, orders, attendees, tickets] = await Promise.all([
    tx.guest.findMany({ where: { eventId: snapshot.eventId, email: { not: null } }, select: { email: true } }),
    tx.ticketOrder.findMany({ where: { eventId: snapshot.eventId }, select: { buyerEmail: true } }),
    tx.orderAttendee.findMany({ where: { order: { eventId: snapshot.eventId } }, select: { email: true, linkedSourceSnapshot: true } }),
    tx.ticket.findMany({ where: { eventId: snapshot.eventId, holderEmail: { not: null } }, select: { holderEmail: true } }),
  ]);
  const originalEmails = attendees.flatMap((person) => {
    const source = person.linkedSourceSnapshot;
    return source && typeof source === 'object' && !Array.isArray(source) && typeof source.email === 'string' ? [source.email] : [];
  });
  const emails = [...guests, ...orders.map((order) => ({ email: order.buyerEmail })), ...attendees, ...tickets.map((ticket) => ({ email: ticket.holderEmail }))].map((person) => person.email);
  const fingerprints = [...new Set([...emails, ...originalEmails].filter((email): email is string => !!email).map(exportSubjectFingerprint))];
  await tx.exportSnapshotSubject.createMany({ data: fingerprints.map((fingerprint) => ({ snapshotId: snapshot.id, fingerprint })), skipDuplicates: true });
}
