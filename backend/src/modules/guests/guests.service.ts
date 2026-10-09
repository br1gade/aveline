import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Rsvp, RsvpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GuestsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The guest graph for an event, grouped by household — every field a host
   * edits, each guest's answer, and whether they have arrived.
   *
   * Contact details and each guest's personal link are included only for a
   * caller holding `guest:contact:read`. The link is a credential: a viewer
   * holding it could answer as the guest.
   */
  async listByHousehold(eventId: string, canSeeContacts: boolean) {
    const households = await this.prisma.household.findMany({
      where: { eventId },
      include: { guests: { include: GUEST_DETAIL, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } },
      orderBy: { name: 'asc' },
    });

    return households.map((h) => ({
      id: h.id,
      name: h.name,
      seatsAllotted: h.seatsAllotted,
      seatsNamed: h.guests.length,
      notes: h.notes,
      guests: h.guests.map((guest) => guestView(guest, canSeeContacts)),
    }));
  }

  /** One guest, for an edit form: their household and their answers to the host's questions. */
  async findOne(eventId: string, guestId: string, canSeeContacts: boolean) {
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, eventId },
      include: {
        ...GUEST_DETAIL,
        rsvp: { include: { answers: { select: { questionId: true, value: true } } } },
      },
    });
    if (!guest) throw new NotFoundException(`No guest ${guestId} on this event`);

    return {
      ...guestView(guest, canSeeContacts),
      householdId: guest.householdId,
      answers: guest.rsvp?.answers ?? [],
    };
  }
}

const GUEST_DETAIL = {
  rsvp: true,
  seat: { include: { table: { select: { name: true } } } },
  seatReleasedFromTable: { select: { name: true } },
  checkIn: { select: { arrivedAt: true } },
} satisfies Prisma.GuestInclude;

type DetailedGuest = Prisma.GuestGetPayload<{ include: typeof GUEST_DETAIL }>;

function guestView(guest: DetailedGuest, canSeeContacts: boolean) {
  const rsvp = rsvpView(guest.rsvp);
  return {
    id: guest.id,
    firstName: guest.firstName,
    lastName: guest.lastName,
    name: [guest.firstName, guest.lastName].filter(Boolean).join(' '),
    ...(canSeeContacts ? { email: guest.email, phone: guest.phone, token: guest.token } : {}),
    locale: guest.locale,
    attribution: guest.attribution,
    isPrimary: guest.isPrimary,
    addedByGuest: guest.addedByGuest,
    isAnonymized: guest.anonymizedAt !== null,
    // Kept beside `rsvp.status` for clients that read the flat field.
    rsvpStatus: rsvp.status,
    rsvp,
    table: guest.seat?.table.name ?? null,
    // Their decline freed this seat; shown until they are seated again.
    seatReleased:
      guest.seatReleasedAt === null
        ? null
        : { table: guest.seatReleasedFromTable?.name ?? null, releasedAt: guest.seatReleasedAt },
    isCheckedIn: guest.checkIn !== null,
    arrivedAt: guest.checkIn?.arrivedAt ?? null,
  };
}

/** What a guest who has not answered looks like. A guest added by a path that wrote no RSVP row is one. */
const NO_ANSWER = {
  status: RsvpStatus.PENDING,
  respondedAt: null,
  dietary: [],
  dietaryNotes: null,
  drinkPreference: null,
  songRequest: null,
  message: null,
};

function rsvpView(rsvp: Rsvp | null) {
  if (!rsvp) return NO_ANSWER;
  return {
    status: rsvp.status,
    respondedAt: rsvp.respondedAt,
    dietary: rsvp.dietary,
    dietaryNotes: rsvp.dietaryNotes,
    drinkPreference: rsvp.drinkPreference,
    songRequest: rsvp.songRequest,
    message: rsvp.message,
  };
}
