import { issuanceStatus } from './issuance-status';
import { OrderAttendee, Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { newGuestToken } from '../guests/guest-token';
import { lockAttendancePolicy, AttendanceContext } from '../rsvp/attendance/attendance-context';
import { VenueAttendanceDto } from '../rsvp/dto/attendance.dto';
import { CustomAnswerDto } from '../rsvp/dto/submit-rsvp.dto';

interface IssuableOrder {
  id: string; eventId: string; buyerName: string; buyerEmail: string; createdAt: Date;
  items: { ticketTypeId: string; quantity: number }[];
  attendees: OrderAttendee[];
}

/** Batch all people/households/answers/tickets; a thousand tickets must not mean a thousand round trips. */
export async function issueAttendeeTickets(tx: Prisma.TransactionClient, original: IssuableOrder) {
  // Re-read after the order claim: erasure may have committed while settlement waited.
  const fresh = await tx.ticketOrder.findUniqueOrThrow({ where: { id: original.id }, select: { buyerName: true, buyerEmail: true, attendees: { orderBy: { position: 'asc' } } } });
  const order = { ...original, ...fresh };
  if (order.attendees.length === 0) {
    await tx.ticket.createMany({ data: order.items.flatMap((item) => Array.from({ length: item.quantity }, () => ({
      eventId: order.eventId, orderId: order.id, ticketTypeId: item.ticketTypeId, code: ticketCode(), holderName: order.buyerName, holderEmail: order.buyerEmail,
    }))) });
    return;
  }
  const people = await createAttendeePeople(tx, order);
  const now = new Date();
  await tx.ticket.createMany({ data: people.map((person) => ({
    eventId: order.eventId, orderId: order.id, ticketTypeId: person.attendee.ticketTypeId, attendeeId: person.attendee.id,
    guestId: person.guestId, code: ticketCode(), holderName: [person.attendee.firstName, person.attendee.lastName].filter(Boolean).join(' '),
    holderEmail: person.attendee.email, issuedAt: now,
  })) });
}

export async function createAttendeePeople(tx: Prisma.TransactionClient, order: IssuableOrder) {
  const policy = await lockAttendancePolicy(tx, order.eventId);
  const now = new Date();
  const people = order.attendees.map((attendee) => ({ attendee, guestId: randomUUID(), rsvpId: randomUUID() }));
  const groups = groupHouseholds(people);
  await tx.household.createMany({ data: [...groups.values()].map((group) => ({
    id: group.id, eventId: order.eventId, name: group.name, seatsAllotted: group.people.length,
  })) });
  await tx.guest.createMany({ data: [...groups.values()].flatMap((group) => group.people.map((person, index) => ({
    id: person.guestId, eventId: order.eventId, householdId: group.id, firstName: person.attendee.firstName, lastName: person.attendee.lastName,
    email: person.attendee.email, phone: person.attendee.phone, locale: person.attendee.locale, token: newGuestToken(),
    isPrimary: index === 0, anonymizedAt: person.attendee.erasedAt, createdAt: now, updatedAt: now,
  }))) });
  await tx.rsvp.createMany({ data: people.map((person) => ({
    id: person.rsvpId, guestId: person.guestId, status: issuanceStatus(policy, person.attendee),
    dietary: person.attendee.dietary, dietaryNotes: person.attendee.dietaryNotes, drinkPreference: person.attendee.drinkPreference,
    respondedAt: hasCurrentAnswers(policy, person.attendee) ? order.createdAt : null, createdAt: now, updatedAt: now,
  })) });
  const responses = people.flatMap((person) => responseRows(person, policy, order.createdAt, now));
  if (responses.length) await tx.attendanceResponse.createMany({ data: responses });
  const answers = people.flatMap((person) => (person.attendee.answers as unknown as CustomAnswerDto[]).map((answer) => ({
    rsvpId: person.rsvpId, questionId: answer.questionId, value: answer.value as Prisma.InputJsonValue,
  })));
  if (answers.length) await tx.rsvpAnswer.createMany({ data: answers });
  // One bulk update records which guests this checkout created; later host linking cannot delete an invited guest.
  await tx.$executeRaw`UPDATE order_attendees a SET "generatedGuestId" = linked."guestId"
    FROM (VALUES ${Prisma.join(people.map((person) => Prisma.sql`(${person.attendee.id}, ${person.guestId})`))}) AS linked(id, "guestId")
    WHERE a.id = linked.id`;
  return people;
}

interface IssuedPerson { attendee: OrderAttendee; guestId: string; rsvpId: string }

function groupHouseholds(people: IssuedPerson[]) {
  const groups = new Map<string, { id: string; name: string; people: IssuedPerson[] }>();
  for (const person of people) {
    const key = person.attendee.householdKey ? `group:${person.attendee.householdKey}` : person.attendee.id;
    const group = groups.get(key) ?? { id: randomUUID(), name: person.attendee.firstName, people: [] };
    group.people.push(person);
    groups.set(key, group);
  }
  return groups;
}

function hasCurrentAnswers(policy: AttendanceContext, attendee: OrderAttendee) {
  return attendee.attendanceRevision === policy.attendanceRevision;
}

function responseRows(person: IssuedPerson, policy: AttendanceContext, respondedAt: Date, now: Date): Prisma.AttendanceResponseCreateManyInput[] {
  if (!hasCurrentAnswers(policy, person.attendee)) return [];
  const scopes = policy.attendanceMode === 'EVENT_WIDE'
    ? [{ venueId: null, scopeId: 'event', status: person.attendee.status }]
    : (person.attendee.venueAttendance as unknown as VenueAttendanceDto[]).map((answer) => ({ ...answer, scopeId: answer.venueId }));
  return scopes.map((answer) => ({ id: randomUUID(), eventId: policy.id, guestId: person.guestId, revision: policy.attendanceRevision,
    ...answer, respondedAt, updatedAt: now }));
}

function ticketCode() { return randomBytes(12).toString('base64url').toUpperCase(); }
