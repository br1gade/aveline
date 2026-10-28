import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isReadableByGuests } from '../invitations/publishing';
import { CorrectNameDto } from './dto/correct-name.dto';

@Injectable()
export class GuestNameService {
  constructor(private readonly prisma: PrismaService) {}

  async correct(slug: string, token: string, dto: CorrectNameDto) {
    return this.prisma.$transaction(async (tx) => {
      // Locks serialize correction with token rotation, host edits and erasure.
      // The link is checked again after waiting, never trusted from an earlier read.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT g.id FROM guests g JOIN invitations i ON i."eventId" = g."eventId"
        WHERE i.slug = ${slug} AND g.token = ${token} FOR UPDATE OF i, g`;
      const guest = rows[0] && await tx.guest.findUnique({ where: { id: rows[0].id },
        select: { id: true, token: true, anonymizedAt: true, event: { select: { invitation: { select: { status: true, expiresAt: true } } } } } });
      assertCorrectable(guest, token);
      const updated = await tx.guest.update({ where: { id: guest.id }, data: {
        firstName: dto.firstName,
        lastName: dto.lastName === undefined ? undefined : dto.lastName?.trim() || null,
      }, select: { id: true, firstName: true, lastName: true } });
      return { ...updated, name: [updated.firstName, updated.lastName].filter(Boolean).join(' ') };
    });
  }
}

type PersonalGuest = Prisma.GuestGetPayload<{ select: {
  id: true; token: true; anonymizedAt: true;
  event: { select: { invitation: { select: { status: true; expiresAt: true } } } };
} }>;

function assertCorrectable(guest: PersonalGuest | null | undefined, token: string): asserts guest is PersonalGuest {
  if (!guest || guest.token !== token || guest.anonymizedAt) throw new NotFoundException('Invitation link not recognised');
  const invitation = guest.event.invitation;
  if (!invitation || !isReadableByGuests(invitation.status)) throw new NotFoundException('Invitation link not recognised');
  if (invitation.expiresAt && invitation.expiresAt <= new Date()) throw new NotFoundException('Invitation link not recognised');
}
