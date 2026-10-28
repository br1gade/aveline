import { Prisma } from '@prisma/client';

function sameAddress(email: string) { return { equals: email, mode: Prisma.QueryMode.insensitive }; }

export function attendeeSubject(email: string, guestIds: string[] = []): Prisma.OrderAttendeeWhereInput {
  return { OR: [{ email: sameAddress(email) }, { ticket: { guest: { email: sameAddress(email) } } },
    { ticket: { guestId: { in: guestIds } } }, { linkedSourceSnapshot: { path: ['email'], equals: email.toLowerCase() } }] };
}

/** Lock ticket orders before guests, matching settlement, admission and cancellation. */
export async function lockSubjectOrders(tx: Prisma.TransactionClient, email: string) {
  const orders = await tx.ticketOrder.findMany({ where: { OR: [{ buyerEmail: sameAddress(email) },
    { attendees: { some: attendeeSubject(email) } }, { tickets: { some: { OR: [{ holderEmail: sameAddress(email) }, { guest: { email: sameAddress(email) } }] } } }] },
  select: { id: true, eventId: true } });
  if (!orders.length) return;
  const events = [...new Set(orders.map((order) => order.eventId))];
  await tx.$queryRaw`SELECT id FROM events WHERE id IN (${Prisma.join(events)}) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM ticket_orders WHERE id IN (${Prisma.join(orders.map((order) => order.id))}) ORDER BY id FOR UPDATE`;
}

export async function eraseAttendees(tx: Prisma.TransactionClient, subject: { email: string; guestIds: string[]; now: Date }) {
  await tx.ticketOrder.updateMany({ where: { attendees: { some: attendeeSubject(subject.email, subject.guestIds) } }, data: { requestFingerprint: null } });
  const result = await tx.orderAttendee.updateMany({ where: attendeeSubject(subject.email, subject.guestIds), data: {
    firstName: 'Removed', lastName: null, email: null, phone: null, householdKey: null,
    dietary: [], dietaryNotes: null, drinkPreference: null, answers: [], linkedSourceSnapshot: Prisma.DbNull, erasedAt: subject.now,
  } });
  return result.count;
}

export function exportAttendees(tx: Prisma.TransactionClient, email: string) {
  return tx.orderAttendee.findMany({ where: attendeeSubject(email), select: {
    firstName: true, lastName: true, email: true, phone: true, locale: true, householdKey: true,
    dietary: true, dietaryNotes: true, drinkPreference: true, answers: true, attendanceRevision: true, status: true,
    venueAttendance: true, linkedSourceSnapshot: true, order: { select: { event: { select: { title: true, startsAt: true } } } },
  } });
}
