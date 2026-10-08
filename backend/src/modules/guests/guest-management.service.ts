import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Guest, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddGuestDto, UpdateGuestDto, UpdateHouseholdDto } from './dto/guest-management.dto';
import {
  AddressInput,
  capacityProblem,
  readEmail,
  readPhone,
  removalProblem,
  toColumn,
} from './guest-rules';
import { newGuestToken } from './guest-token';
import { lockHousehold, lockHouseholds } from './household-lock';

interface LockedGuest {
  id: string;
  householdId: string;
  isPrimary: boolean;
  anonymizedAt: Date | null;
}

/**
 * A host's edits to their guest list, one person at a time.
 *
 * CSV import is how a list arrives; this is how it is kept right afterwards —
 * the cousin who was forgotten, the address that bounced, the plus-one who is
 * no longer coming. Every write that changes who is in a household locks that
 * household first (see `household-lock.ts`), so these and a guest's own RSVP
 * cannot together put more people in it than it has seats.
 */
@Injectable()
export class GuestManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async addGuest(eventId: string, dto: AddGuestDto) {
    const email = accepted(readEmail(dto.email));
    const phone = accepted(readPhone(dto.phone));

    const guest = await this.prisma.$transaction(async (tx) => {
      const { householdId, isFirst } = await this.householdToJoin(tx, eventId, dto);

      return tx.guest.create({
        data: {
          eventId,
          householdId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName?.trim() || null,
          email: toColumn(email) ?? null,
          phone: toColumn(phone) ?? null,
          locale: dto.locale ?? null,
          attribution: dto.attribution,
          token: newGuestToken(),
          // The first person in a household holds its invitation link.
          isPrimary: isFirst,
          // Typed in by the host: the same lawful basis as an import, recorded
          // under its own source so the two can be told apart.
          consentAt: new Date(),
          consentSource: 'host-entry',
          rsvp: { create: {} },
        },
      });
    });

    return guestView(guest);
  }

  async updateGuest(eventId: string, guestId: string, dto: UpdateGuestDto) {
    const email = accepted(readEmail(dto.email));
    const phone = accepted(readPhone(dto.phone));

    const guest = await this.prisma.$transaction(async (tx) => {
      const current = await lockGuest(tx, eventId, guestId);
      if (current.anonymizedAt) {
        throw new BadRequestException("This guest's details were erased at their request");
      }

      await this.moveIfAsked(tx, eventId, current, dto.householdId);

      return tx.guest.update({
        where: { id: guestId },
        data: {
          firstName: dto.firstName?.trim(),
          lastName: dto.lastName === undefined ? undefined : dto.lastName.trim() || null,
          email: toColumn(email),
          phone: toColumn(phone),
          locale: dto.locale,
          attribution: dto.attribution,
        },
      });
    });

    return guestView(guest);
  }

  /**
   * Removes a guest with their answer and seat, so the headcount, catering
   * sheet and seating plan stop counting them. Messages already sent keep
   * their record with the guest detached.
   */
  async removeGuest(eventId: string, guestId: string) {
    return this.prisma.$transaction(async (tx) => {
      // The guest row is locked before checking for an arrival, so a check-in
      // recorded at the same moment either lands first and is seen here, or
      // waits and then fails on a guest that no longer exists. Never both.
      const guest = await lockGuest(tx, eventId, guestId);
      await lockHousehold(tx, eventId, guest.householdId);

      const checkIn = await tx.checkIn.findUnique({ where: { guestId }, select: { id: true } });
      const problem = removalProblem({
        checkedIn: checkIn !== null,
        anonymized: guest.anonymizedAt !== null,
      });
      if (problem) throw new BadRequestException(problem);

      await tx.guest.delete({ where: { id: guestId } });
      const isHouseholdRemoved = await settleHousehold(tx, guest.householdId, guest.isPrimary);

      return { removed: guestId, isHouseholdRemoved };
    });
  }

  /** Renames a household or changes its seats — never below the people already named in it. */
  async updateHousehold(eventId: string, householdId: string, dto: UpdateHouseholdDto) {
    return this.prisma.$transaction(async (tx) => {
      const household = await lockHousehold(tx, eventId, householdId);

      if (dto.seatsAllotted !== undefined && dto.seatsAllotted < household.namedGuests) {
        throw new BadRequestException(
          `seatsAllotted: ${household.namedGuests} guest(s) are already named in this household; remove or move some first`,
        );
      }

      const updated = await tx.household.update({
        where: { id: householdId },
        data: { name: dto.name?.trim(), seatsAllotted: dto.seatsAllotted },
      });

      return {
        id: updated.id,
        name: updated.name,
        seatsAllotted: updated.seatsAllotted,
        seatsNamed: household.namedGuests,
      };
    });
  }

  /**
   * The household a new guest goes into: an existing one with room, or a new
   * one of their own named after them.
   */
  private async householdToJoin(
    tx: Prisma.TransactionClient,
    eventId: string,
    dto: AddGuestDto,
  ): Promise<{ householdId: string; isFirst: boolean }> {
    if (dto.householdId) {
      const household = await lockHousehold(tx, eventId, dto.householdId);
      const problem = capacityProblem(household.seatsAllotted, household.namedGuests + 1);
      if (problem) throw new BadRequestException(`householdId: ${problem}`);
      return { householdId: household.id, isFirst: household.namedGuests === 0 };
    }

    const name = [dto.firstName, dto.lastName].map((part) => part?.trim()).filter(Boolean).join(' ');
    const created = await tx.household.create({
      data: { eventId, name, seatsAllotted: dto.seatsAllotted ?? 1 },
      select: { id: true },
    });
    return { householdId: created.id, isFirst: true };
  }

  /**
   * Moves a guest to another household on the same event, if asked to.
   *
   * The destination must have a free seat. The household left behind keeps
   * a primary — the one who holds the link — or is removed if nobody is left
   * in it, because an empty household is an invitation addressed to no one.
   */
  private async moveIfAsked(
    tx: Prisma.TransactionClient,
    eventId: string,
    guest: LockedGuest,
    targetId: string | undefined,
  ): Promise<void> {
    if (!targetId || targetId === guest.householdId) return;

    const locked = await lockHouseholds(tx, eventId, [guest.householdId, targetId]);
    const target = locked.get(targetId);
    if (!target) throw new NotFoundException(`No household ${targetId} on this event`);

    const problem = capacityProblem(target.seatsAllotted, target.namedGuests + 1);
    if (problem) throw new BadRequestException(`householdId: ${problem}`);

    await tx.guest.update({
      where: { id: guest.id },
      data: { householdId: targetId, isPrimary: target.namedGuests === 0 },
    });
    await settleHousehold(tx, guest.householdId, guest.isPrimary);
  }
}

/** Locks one guest row on this event, or 404s. */
async function lockGuest(
  tx: Prisma.TransactionClient,
  eventId: string,
  guestId: string,
): Promise<LockedGuest> {
  const rows = await tx.$queryRaw<LockedGuest[]>`
    SELECT id, "householdId", "isPrimary", "anonymizedAt" FROM guests
    WHERE id = ${guestId} AND "eventId" = ${eventId}
    FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException(`No guest ${guestId} on this event`);
  return rows[0];
}

/**
 * After someone leaves a household: remove it if it is now empty, otherwise
 * make sure someone still holds its link. Returns whether it was removed.
 */
async function settleHousehold(
  tx: Prisma.TransactionClient,
  householdId: string,
  wasPrimaryWhoLeft: boolean,
): Promise<boolean> {
  const next = await tx.guest.findFirst({
    where: { householdId },
    orderBy: [{ addedByGuest: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });

  if (!next) {
    await tx.household.delete({ where: { id: householdId } });
    return true;
  }
  if (wasPrimaryWhoLeft) {
    await tx.guest.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  return false;
}

/** The value to write, or a 400 naming the field. */
function accepted(input: AddressInput): AddressInput {
  if (input.kind === 'invalid') throw new BadRequestException(input.message);
  return input;
}

function guestView(guest: Guest) {
  return {
    id: guest.id,
    householdId: guest.householdId,
    firstName: guest.firstName,
    lastName: guest.lastName,
    email: guest.email,
    phone: guest.phone,
    locale: guest.locale,
    attribution: guest.attribution,
    isPrimary: guest.isPrimary,
    token: guest.token,
  };
}
