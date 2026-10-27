import { lockOwnerAddress, lockCurrentUsers } from '../../infra/auth/access-locks';
import { resolveCustomerOrganizations, selectionRequired, accessDenied } from '../../infra/auth/organization-context';
import { actorCan } from '../../infra/auth/actor';
import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRole, OrgKind } from '@prisma/client';
import { AccountService } from '../../infra/auth/account.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEventDto } from '../events/dto/create-event.dto';
import { EventsService } from '../events/events.service';
import { OpenForCustomerDto } from './dto/concierge.dto';

/**
 * Aveline staff setting an event up for a customer, then handing it over
 * (spec §11; decided 9 October 2026).
 *
 * Staff open the organization and its events without becoming a member of
 * either — they act through their platform role — and the customer is
 * invited as owner, choosing their own password on acceptance. Staff never
 * hold a customer's credential, and when the customer accepts, nothing of
 * the staff member's is left in their organization.
 */
@Injectable()
export class ConciergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly accounts: AccountService,
  ) {}

  /**
   * A customer who already has an organization gets the event built in it
   * (decided 10 October 2026, D8): no second organization, nothing to
   * accept. Inviting them as owner of a new one could never be accepted —
   * an account has one organization — and orphaned the staff's work.
   */
  async openForCustomer(staffUserId: string, dto: OpenForCustomerDto) {
    const email = dto.ownerEmail.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerAddress(tx, email);
      const resolved = await resolveCustomerOrganizations(tx, { ownerEmail: email, selectedOrganizationId: dto.organizationId });
      if (resolved.kind === 'selection-required') throw selectionRequired();
      if (resolved.kind === 'one') {
        await lockCurrentUsers(tx, [staffUserId]);
        const staff = await tx.user.findUnique({ where: { id: staffUserId }, select: { isActive: true, platformRole: true } });
        if (!staff?.isActive || !actorCan({ userId: staffUserId, email: '', platformRole: staff.platformRole }, 'concierge:manage')) throw accessDenied();
        const organization = await tx.organization.findUniqueOrThrow({ where: { id: resolved.organizationId }, select: { id: true, name: true, kind: true, createdAt: true } });
        return { organization, invite: null, isExisting: true };
      }
      const organization = await tx.organization.create({ data: { name: dto.name, kind: dto.kind ?? OrgKind.HOST }, select: { id: true, name: true, kind: true, createdAt: true } });
      const invite = await this.accounts.inviteMemberInTransaction(tx, { organizationId: organization.id, invitedByUserId: staffUserId, dto: { email, role: OrganizationRole.OWNER }, isConcierge: true });
      return { organization, invite, isExisting: false };
    }, { timeout: 10_000, maxWait: 5000 });
  }

  async createEvent(organizationId: string, staffUserId: string, dto: CreateEventDto) {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new NotFoundException(`No organization ${organizationId}`);
    return this.events.create(organizationId, staffUserId, dto, { isOnBehalf: true });
  }

  /** Finding a customer's organization again — with who owns it, or who has yet to accept. */
  async find(search?: string) {
    const organizations = await this.prisma.organization.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        name: true,
        kind: true,
        createdAt: true,
        memberships: { where: { role: OrganizationRole.OWNER }, select: { user: { select: { email: true } } } },
        invites: {
          where: { role: OrganizationRole.OWNER, acceptedAt: null, revokedAt: null },
          select: { email: true },
        },
        _count: { select: { events: true } },
      },
    });

    return organizations.map(({ memberships, invites, _count, ...organization }) => ({
      ...organization,
      events: _count.events,
      owners: memberships.map((membership) => membership.user.email),
      pendingOwnerInvites: invites.map((invite) => invite.email),
    }));
  }
}
