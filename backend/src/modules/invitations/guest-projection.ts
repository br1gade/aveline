import { Prisma } from '@prisma/client';
import { ACTIVE_ATTENDANCE, ATTENDANCE_GUEST } from '../rsvp/attendance/attendance-view';
import { SEAT_DETAIL } from '../seating/seat-view';
import { loadHouseholdSnapshots } from './guest-household-snapshot';

const PERSON_SELECT = {
  id: true, firstName: true, lastName: true, locale: true,
  attendanceResponses: ACTIVE_ATTENDANCE,
  rsvp: { select: { status: true, respondedAt: true } },
} satisfies Prisma.GuestSelect;
const EVENT_SELECT = { seatingPublishedAt: true, ...ATTENDANCE_GUEST.event.select } satisfies Prisma.EventSelect;
const HOUSEHOLD_SELECT = {
      name: true, seatsAllotted: true,
      guests: {
        where: { anonymizedAt: null },
        orderBy: { isPrimary: 'desc' },
        select: { ...PERSON_SELECT, seats: { include: { table: SEAT_DETAIL.table } } },
      },
} satisfies Prisma.HouseholdSelect;
const GUEST_SELECT = {
  ...PERSON_SELECT, event: { select: EVENT_SELECT }, household: { select: HOUSEHOLD_SELECT },
} satisfies Prisma.GuestSelect;

export type LoadedGuest = Prisma.GuestGetPayload<{ select: typeof GUEST_SELECT }> & { payloadRevision?: string };

interface ProjectionRequest {
  id: string;
  resolve: (guest: LoadedGuest | null) => void;
  reject: (error: unknown) => void;
}

export class GuestProjectionReader {
  private readonly queues = new Map<string, ProjectionRequest[]>();
  private pendingCount = 0;
  constructor(private readonly prisma: Prisma.TransactionClient) {}

  read(eventId: string, id: string): Promise<LoadedGuest | null> {
    if (this.pendingCount >= 1000) return this.prisma.guest.findFirst({ where: { id, eventId, anonymizedAt: null }, select: GUEST_SELECT });
    return new Promise((resolve, reject) => {
      this.pendingCount += 1;
      const request = { id, resolve, reject };
      const queue = this.queues.get(eventId);
      if (queue) { queue.push(request); return; }
      this.queues.set(eventId, [request]);
      setImmediate(() => { void this.drain(eventId); });
    });
  }

  private async drain(eventId: string): Promise<void> {
    const queue = this.queues.get(eventId)!;
    while (queue.length) {
      const batch = queue.splice(0, 100);
      try {
        const guests = await this.load(eventId, batch);
        const byId = new Map(guests.map((guest) => [guest.id, guest]));
        batch.forEach((request) => request.resolve(byId.get(request.id) ?? null));
      } catch (error) { batch.forEach((request) => request.reject(error)); }
      finally { this.pendingCount -= batch.length; }
    }
    this.queues.delete(eventId);
  }

  private async load(eventId: string, batch: ProjectionRequest[]): Promise<LoadedGuest[]> {
    if (batch.length === 1) {
      const guest = await this.prisma.guest.findFirst({ where: { id: batch[0].id, eventId, anonymizedAt: null }, select: GUEST_SELECT });
      return guest ? [guest] : [];
    }
    const ids = new Set(batch.map((request) => request.id));
    const snapshots = await loadHouseholdSnapshots(this.prisma, eventId, [...ids]);
    return snapshots.flatMap(({ event, household, payloadRevision }) => household.guests.filter((guest) => ids.has(guest.id))
      .map((guest) => ({ ...guest, event, household, payloadRevision })));
  }
}
