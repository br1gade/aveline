import { pageOf, parseOrganizationCursor } from './organization-pagination';
import { lockOwnerAddress, lockCurrentUsers, lockOrganizationStanding } from '../../infra/auth/access-locks';
import { validateOrganizationId, selectionRequired, accessDenied } from '../../infra/auth/organization-context';
import { actorCan } from '../../infra/auth/actor';
import { conciergeRelationshipQuery, describeConciergeMatch, liveOwnerInvites } from './concierge-relationship';
import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRole, OrgKind, Prisma } from '@prisma/client';
import { AccountService } from '../../infra/auth/account.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEventDto } from '../events/dto/create-event.dto';
import { EventsService } from '../events/events.service';
import { OpenForCustomerDto, ResolveCustomerOrganizationsDto } from './dto/concierge.dto';

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
   * (decided 10 October 2026, D8). Several current relationships require an
   * explicit selection; no first row may silently choose a different tenant.
   */
  async openForCustomer(staffUserId: string, dto: OpenForCustomerDto) {
    const email = dto.ownerEmail.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      await lockOwnerAddress(tx, email);
      const existing = await this.findCustomerMatch(tx, email, dto.organizationId);
      if (existing) {
        const { relationship, ...organization } = await this.recheckCustomerMatch(tx, { email, organizationId: existing.id, staffUserId });
        return { organization, invite: null, isExisting: true, relationship };
      }
      const organization = await tx.organization.create({ data: { name: dto.name, kind: dto.kind ?? OrgKind.HOST }, select: { id: true, name: true, kind: true, createdAt: true } });
      const invite = await this.accounts.inviteMemberInTransaction(tx, { organizationId: organization.id, invitedByUserId: staffUserId, dto: { email, role: OrganizationRole.OWNER }, isConcierge: true });
      return { organization, invite, isExisting: false };
    }, { timeout: 10_000, maxWait: 5000 });
  }

  private async findCustomerMatch(tx: Prisma.TransactionClient, email: string, selectedId?: string) {
    const query = conciergeRelationshipQuery(email);
    if (selectedId !== undefined) {
      const match = await tx.organization.findFirst({
        ...query, where: { ...query.where, id: validateOrganizationId(selectedId) },
      });
      if (!match) throw accessDenied();
      return match;
    }
    const matches = await tx.organization.findMany({ ...query, take: 2 });
    if (matches.length > 1) throw selectionRequired();
    return matches[0];
  }

  private async recheckCustomerMatch(tx: Prisma.TransactionClient, input: {
    email: string; organizationId: string; staffUserId: string;
  }) {
    const { email, organizationId, staffUserId } = input;
    await lockOrganizationStanding(tx, { organizationId });
    const current = await this.findCustomerMatch(tx, email, organizationId);
    await lockCurrentUsers(tx, [staffUserId, ...current.memberships.map(({ userId }) => userId)]);
    const staff = await tx.user.findUnique({ where: { id: staffUserId }, select: { isActive: true, platformRole: true } });
    if (!staff?.isActive || !actorCan({ userId: staffUserId, email: '', platformRole: staff.platformRole }, 'concierge:manage')) throw accessDenied();
    return describeConciergeMatch(await this.findCustomerMatch(tx, email, organizationId));
  }

  async resolveCustomer(dto: ResolveCustomerOrganizationsDto) {
    const cursor = parseOrganizationCursor(dto.cursor);
    const after = cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {};
    const query = conciergeRelationshipQuery(dto.ownerEmail.trim().toLowerCase());
    const rows = await this.prisma.organization.findMany({
      ...query, where: { AND: [query.where, after] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: dto.limit + 1,
    });
    return pageOf(rows.map(describeConciergeMatch), dto.limit);
  }

  async createEvent(organizationId: string, staffUserId: string, dto: CreateEventDto) {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new NotFoundException(`No organization ${organizationId}`);
    return this.events.create(organizationId, staffUserId, dto, { isOnBehalf: true });
  }

  /** Finding a customer's organization again — with who owns it, or who has yet to accept. */
  async find(search?: string) {
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null, name: search ? { contains: search, mode: 'insensitive' } : undefined },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        name: true,
        kind: true,
        createdAt: true,
        memberships: { where: { role: OrganizationRole.OWNER }, select: { user: { select: { email: true } } } },
        invites: {
          where: liveOwnerInvites(),
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
