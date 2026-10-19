import { lockCheckoutQuestions } from './checkout-questions';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { webcrypto } from 'node:crypto';
import { assertAttendanceRevision, lockAttendancePolicy, normalizePersonAttendance } from '../rsvp/attendance/attendance-context';
import { answersProblem, unansweredRequired } from '../rsvp/answers';
import { builtInAnswerProblem } from '../rsvp/rsvp-fields';
import { CreateOrderDto, OrderLineDto } from './dto/create-order.dto';
import { OrderAttendeeDto } from './dto/attendee.dto';
import { readPhone, toColumn } from '../guests/guest-rules';

export function rosterProblem(items: OrderLineDto[], attendees?: OrderAttendeeDto[]): string | null {
  if (!attendees?.length || attendees.length > 1000) return 'attendees: supply one named person per ticket, at most 1000';
  if (new Set(items.map((item) => item.ticketTypeId)).size !== items.length) return 'items: list each ticket type once';
  const counts = new Map<string, number>();
  for (const person of attendees) counts.set(person.ticketTypeId, (counts.get(person.ticketTypeId) ?? 0) + 1);
  if (items.length !== counts.size || items.some((item) => counts.get(item.ticketTypeId) !== item.quantity)) {
    return 'attendees: attendee counts must exactly match each requested ticket type';
  }
  return null;
}

export async function prepareRoster(tx: Prisma.TransactionClient, eventId: string, dto: CreateOrderDto) {
  const problem = rosterProblem(dto.items, dto.attendees);
  if (problem) throw new BadRequestException(problem);
  const policy = await lockAttendancePolicy(tx, eventId);
  assertAttendanceRevision(policy, dto.attendanceRevision);
  await lockCheckoutQuestions(tx, eventId);
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: {
    locales: true, defaultLocale: true, invitation: { select: { rsvpFields: true, questions: { select: { id: true, type: true, required: true, options: true } } } },
  } });
  return dto.attendees.map((person, position) => {
    const normalized = normalizePersonAttendance(policy, person, [], 'ATTENDING');
    const locale = person.locale ?? dto.locale ?? event.defaultLocale;
    validatePerson(normalized, event, locale);
    return attendeeRow(normalized, { eventId, position, locale, attendanceRevision: policy.attendanceRevision });
  });
}

function validatePerson(person: OrderAttendeeDto & { status: import('@prisma/client').RsvpStatus }, event: {
  locales: string[]; invitation: { rsvpFields: unknown; questions: import('../rsvp/answers').AnswerableQuestion[] } | null;
}, locale: string) {
  if (!event.locales.includes(locale)) throw new BadRequestException('attendees.locale: use one of the event languages');
  const questions = (event.invitation?.questions ?? []).filter((question) => question.type !== 'SIGNATURE');
  const supplied = person.answers ?? [];
  const error = answersProblem(questions, supplied) ?? builtInAnswerProblem(event.invitation?.rsvpFields, person);
  const missing = unansweredRequired(questions, new Set(supplied.map((answer) => answer.questionId)), person.status);
  if (error || missing) throw new BadRequestException(`attendees: ${error ?? `answer ${missing!.id} is required`}`);
}

function attendeeRow(person: OrderAttendeeDto & { status: import('@prisma/client').RsvpStatus }, context: { eventId: string; position: number; locale: string; attendanceRevision: number }) {
  const phone = readPhone(person.phone);
  if (phone.kind === 'invalid') throw new BadRequestException(`attendees.${phone.message}`);
  return {
    ...context, ticketTypeId: person.ticketTypeId, firstName: person.firstName.trim(), lastName: person.lastName?.trim() || null,
    email: person.email?.trim().toLowerCase() ?? null, phone: toColumn(phone) ?? null, householdKey: person.householdKey ?? null,
    status: person.status, ...answerColumns(person),
  };
}

function answerColumns(person: OrderAttendeeDto) {
  return {
    dietary: person.dietary ?? [], dietaryNotes: person.dietaryNotes ?? null, drinkPreference: person.drinkPreference ?? null,
    venueAttendance: (person.venueAttendance ?? []) as unknown as Prisma.InputJsonValue,
    answers: (person.answers ?? []) as unknown as Prisma.InputJsonValue,
  };
}

/** Fingerprint is an intent check; it never substitutes for the buyer's access token. */
export async function checkoutFingerprint(slug: string, dto: CreateOrderDto): Promise<string> {
  const canonical = { slug, items: dto.items, buyerName: dto.buyerName, buyerEmail: dto.buyerEmail.toLowerCase(), buyerPhone: dto.buyerPhone ?? null,
    locale: dto.locale ?? null, provider: dto.provider ?? null, returnUrl: dto.returnUrl ?? null, promoCode: dto.promoCode ?? null,
    attendanceRevision: dto.attendanceRevision ?? null, attendees: dto.attendees };
  const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stableValue(canonical))));
  return Buffer.from(hash).toString('hex');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

/** Serialize duplicate intent creation before either request takes inventory locks. */
export async function claimCheckout(tx: Prisma.TransactionClient, idempotencyKey: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))::text`;
  const existing = await tx.ticketOrder.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (existing) throw new ConflictException('idempotencyKey: checkout already exists');
}
