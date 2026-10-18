import { randomUUID } from 'node:crypto';
import { AttendanceMode, PrismaClient } from '@prisma/client';
import { AttendancePolicyService } from '../../src/modules/events/attendance-policy.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { seedEvent } from './event.fixture';

/** Four-script, 400-person / 100-household rehearsal, with two separate rooms. */
export async function seedSeatingRehearsal(prisma: PrismaClient, mode: AttendanceMode) {
  const event = await seedEvent(prisma);
  const first = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
  await prisma.venue.update({ where: { id: first.id }, data: { capacity: 400 } });
  const second = await prisma.venue.create({ data: { eventId: event.eventId, role: 'CEREMONY', name: 'Second room', address: 'Two', capacity: 400 } });
  const households = Array.from({ length: 99 }, (_, index) => ({ id: randomUUID(), eventId: event.eventId, name: `Family ${index + 2}`, seatsAllotted: 4 }));
  await prisma.household.createMany({ data: households });
  const ids = [event.householdId, ...households.map((household) => household.id)];
  const names = ['Անահիտ', 'Иван', 'Émilie', 'William'];
  const guests = Array.from({ length: 399 }, (_, index) => ({ id: randomUUID(), eventId: event.eventId,
    householdId: ids[Math.floor((index + 1) / 4)], firstName: names[index % 4], token: randomUUID() }));
  await prisma.guest.createMany({ data: guests });
  await prisma.rsvp.createMany({ data: guests.map((guest) => ({ guestId: guest.id, status: 'ATTENDING' })) });
  await prisma.table.createMany({ data: [first, second].flatMap((venue) => Array.from({ length: 50 }, (_, index) => ({ eventId: event.eventId,
    venueId: venue.id, name: `Table ${index + 1}`, capacity: 8 }))) });
  if (mode === 'PER_VENUE') await switchAttendance(prisma, event.eventId, [first.id, second.id]);
  await prisma.rsvp.updateMany({ where: { guest: { eventId: event.eventId } }, data: { status: 'ATTENDING' } });
  const arrangements = await prisma.seatingArrangement.findMany({ where: { eventId: event.eventId, venueId: { in: [first.id, second.id] } }, orderBy: { venueId: 'asc' } });
  return { ...event, firstArrangement: arrangements.find((arrangement) => arrangement.venueId === first.id)!, secondArrangement: arrangements.find((arrangement) => arrangement.venueId === second.id)! };
}
async function switchAttendance(prisma: PrismaClient, eventId: string, venues: string[]) {
  const policy = new AttendancePolicyService(prisma as unknown as PrismaService, { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService);
  const preview = await policy.preview(eventId, 'PER_VENUE');
  await policy.change(eventId, { ...preview.request, transitionId: randomUUID() });
  const guests = await prisma.guest.findMany({ where: { eventId }, select: { id: true, householdId: true }, orderBy: [{ householdId: 'asc' }, { id: 'asc' }] });
  await prisma.attendanceResponse.createMany({ data: guests.flatMap((guest, index) => venues.map((venueId, venueIndex) => ({ id: randomUUID(), eventId, guestId: guest.id,
    revision: 2, scopeId: venueId, venueId, status: venueIndex === 1 && index >= 200 ? 'DECLINED' : 'ATTENDING' }))) });
}
