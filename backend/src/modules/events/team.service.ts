import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Who works on one event, and as what.
 *
 * Changes take effect on the next request: the guard reads roles from the
 * database every time, so a removed coordinator is locked out at once, not
 * when a token expires. An event always keeps an owner — without one nobody
 * could manage its team again.
 */
@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventId: string) {
    const [members, invites] = await Promise.all([
      this.prisma.eventMembership.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
        select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.eventInvite.findMany({
        where: { eventId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { email: true, role: true, expiresAt: true, createdAt: true },
      }),
    ]);

    return {
      members: members.map((member) => ({
        userId: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
        since: member.createdAt,
      })),
      invites,
    };
  }

  async changeRole(eventId: string, userId: string, role: EventRole) {
    return this.prisma.$transaction(async (tx) => {
      const member = await lockedMember(tx, eventId, userId);
      if (member.role === EventRole.OWNER && role !== EventRole.OWNER) await assertAnotherOwner(tx, eventId);

      const updated = await tx.eventMembership.update({
        where: { userId_eventId: { userId, eventId } },
        data: { role },
      });
      return { userId, role: updated.role };
    });
  }

  async remove(eventId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await lockedMember(tx, eventId, userId);
      if (member.role === EventRole.OWNER) await assertAnotherOwner(tx, eventId);

      await tx.eventMembership.delete({ where: { userId_eventId: { userId, eventId } } });
      return { removed: userId };
    });
  }
}

/**
 * The membership, with the event's row locked first: two owners demoting each
 * other at the same moment would otherwise both see a second owner and leave
 * the event with none.
 */
async function lockedMember(tx: Prisma.TransactionClient, eventId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
  const member = await tx.eventMembership.findUnique({ where: { userId_eventId: { userId, eventId } } });
  if (!member) throw new NotFoundException("That person is not on this event's team");
  return member;
}

async function assertAnotherOwner(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const owners = await tx.eventMembership.count({ where: { eventId, role: EventRole.OWNER } });
  if (owners <= 1) {
    throw new BadRequestException('An event needs an owner; make someone else an owner first');
  }
}
