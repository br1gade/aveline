import { recordOrganizationAccessChange } from './organization-access-evidence';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { webcrypto } from 'node:crypto';
import { RequestActor } from '../../infra/auth/actor';
import { lockOwnerAddress, lockOrganizationStanding, requireCurrentOrganizationPermission } from '../../infra/auth/access-locks';
import { accessDenied } from '../../infra/auth/organization-context';
import { canAddOrganizationMembership } from '../../infra/auth/organization-write-gate';
import { DomainHttpException } from '../../common/domain-http.exception';
import { assertOtherOrganizationOwner, incrementOrganizationRevision, lockOrganizationMutation, removeOrganizationAccess, requireActiveMember } from './organization-membership';
import { organizationCursorWhere, pageOf, parseOrganizationCursor } from './organization-pagination';
import { MembershipPageQuery } from './dto/organization.dto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRole, OrgKind } from '@prisma/client';
import { isUniqueViolation } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto, RenameOrganizationDto } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrganizationDto, key?: string) {
    if (key !== undefined && !/^[A-Za-z0-9_-]{1,120}$/.test(key)) throw new BadRequestException('Idempotency-Key: must match 1–120 letters, digits, underscores or hyphens');
    const requestBody = Buffer.from(JSON.stringify({ name: dto.name, kind: dto.kind ?? OrgKind.HOST }));
    const fingerprint = Buffer.from(await webcrypto.subtle.digest('SHA-256', requestBody)).toString('hex');
    const organizationId = await this.prisma.$transaction(async (tx) => {
      const identity = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
      await lockOwnerAddress(tx, identity.email);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true } });
      if (!user?.isActive) throw accessDenied();
      const canAddMembership = await canAddOrganizationMembership(tx);
      const replay = key ? await tx.organizationCreateIntent.findUnique({ where: { actorUserId_key: { actorUserId: userId, key } } }) : null;
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new DomainHttpException('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key: already used for another request');
        const membership = await tx.organizationMembership.findUnique({ where: { userId_organizationId: { userId, organizationId: replay.organizationId } } });
        if (!membership) throw accessDenied();
        return replay.organizationId;
      }
      await assertOrganizationCreationAllowed(tx, userId, canAddMembership);
      const created = await tx.organization.create({ data: { name: dto.name, kind: dto.kind ?? OrgKind.HOST } });
      await tx.organizationMembership.create({ data: { userId, organizationId: created.id, role: OrganizationRole.OWNER } });
      if (key) await tx.organizationCreateIntent.create({ data: { actorUserId: userId, key, fingerprint, organizationId: created.id } });
      await recordOrganizationAccessChange(tx, { organizationId: created.id, actorUserId: userId, subjectUserId: userId, action: 'CREATED', role: 'OWNER', accessRevision: 0 });
      return created.id;
    }, { timeout: 10_000, maxWait: 5000 }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new ConflictException('You already belong to an organization; one organization per account for now');
      throw error;
    });
    return this.describe(organizationId);
  }

  async ownMemberships(userId: string, query: MembershipPageQuery) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { userId, user: { isActive: true }, organization: { deletedAt: null }, ...organizationCursorWhere(parseOrganizationCursor(query.cursor)) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: query.limit + 1,
      select: { id: true, organizationId: true, role: true, createdAt: true, organization: { select: { name: true, kind: true } } },
    });
    const page = pageOf(rows, query.limit);
    return { ...page, items: page.items.map(({ organizationId, role, createdAt, organization }) => ({ organizationId, ...organization, role, joinedAt: createdAt })) };
  }

  async members(organizationId: string, query: MembershipPageQuery) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId, ...organizationCursorWhere(parseOrganizationCursor(query.cursor)) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: query.limit + 1,
      select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true } } },
    });
    const page = pageOf(rows, query.limit);
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { accessRevision: true } });
    return { ...page, ...organization, items: page.items.map(({ userId, role, createdAt, user }) => ({ userId, name: user.name, role, joinedAt: createdAt })) };
  }

  changeMember(organizationId: string, actor: RequestActor, input: { userId: string; role: OrganizationRole; expectedRevision: number }) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganizationMutation(tx, organizationId, input.expectedRevision);
      await requireCurrentOrganizationPermission(tx, { actor, organizationId, permission: 'member:manage' });
      const member = await requireActiveMember(tx, organizationId, input.userId);
      if (member.role === 'OWNER' && input.role !== 'OWNER') await assertOtherOrganizationOwner(tx, organizationId, input.userId);
      await tx.organizationMembership.update({ where: { id: member.id }, data: { role: input.role } });
      const accessRevision = await incrementOrganizationRevision(tx, organizationId);
      await recordOrganizationAccessChange(tx, { organizationId, actorUserId: actor.userId, subjectUserId: input.userId,
        action: 'ROLE_CHANGED', previousRole: member.role, role: input.role, accessRevision });
      return { organizationId, userId: input.userId, role: input.role, accessRevision };
    }, { timeout: 10_000, maxWait: 5000 });
  }

  transferOwner(organizationId: string, actor: RequestActor, input: { successorUserId: string; expectedRevision: number }) {
    return this.changeMember(organizationId, actor, { userId: input.successorUserId, role: OrganizationRole.OWNER, expectedRevision: input.expectedRevision });
  }

  removeMember(organizationId: string, actor: RequestActor, input: { userId: string; expectedRevision: number }) {
    return this.prisma.$transaction((tx) => removeOrganizationAccess(tx, { organizationId, actor, ...input }), { timeout: 10_000, maxWait: 5000 });
  }

  async current(organizationId: string) {
    return this.describe(organizationId);
  }

  async rename(organizationId: string, dto: RenameOrganizationDto, actor?: RequestActor) {
    await this.prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId, mode: 'update' });
      if (actor) await requireCurrentOrganizationPermission(tx, { actor, organizationId, permission: 'member:manage' });
      await tx.organization.update({ where: { id: organizationId }, data: { name: dto.name } });
    });
    return this.describe(organizationId);
  }

  private async describe(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        subscription: { include: { plan: { select: { key: true, name: true, tier: true } } } },
        _count: { select: { events: true, memberships: true } },
      },
    });
    if (!organization) throw new NotFoundException('No such organization');

    return {
      id: organization.id,
      name: organization.name,
      kind: organization.kind,
      events: organization._count.events,
      members: organization._count.memberships,
      plan: organization.subscription?.plan ?? null,
      subscriptionStatus: organization.subscription?.status ?? null,
      accessRevision: organization.accessRevision,
      createdAt: organization.createdAt,
    };
  }
}

async function assertOrganizationCreationAllowed(tx: Prisma.TransactionClient, userId: string, canAddMembership: boolean): Promise<void> {
  if (canAddMembership) return;
  const memberships = await tx.organizationMembership.findMany({
    where: { userId }, select: { organization: { select: { name: true } } }, take: 2,
  });
  if (!memberships.length) return;
  if (memberships.length === 1) {
    throw new ConflictException(`You already belong to "${memberships[0].organization.name}"; one organization per account for now`);
  }
  throw new ConflictException('You already belong to an organization; one organization per account for now');
}
