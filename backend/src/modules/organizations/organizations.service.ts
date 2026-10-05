import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRole, OrgKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto, RenameOrganizationDto } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the tenant a new account works inside, with that account as owner.
   *
   * One per user for now. The guard resolves "your organization" from the
   * caller's single membership, so allowing a second would silently make every
   * organization-scoped route act on whichever row came back first — a wrong
   * answer is worse than a refusal that says where to look.
   */
  async create(userId: string, dto: CreateOrganizationDto) {
    const existing = await this.prisma.organizationMembership.findFirst({
      where: { userId },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (existing) {
      throw new ConflictException(
        `You already belong to "${existing.organization.name}"; one organization per account for now`,
      );
    }

    // Both or neither: an organization with no owner is unreachable, and a
    // membership with no organization is a broken foreign key.
    const organization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: dto.name, kind: dto.kind ?? OrgKind.HOST },
      });
      await tx.organizationMembership.create({
        data: { userId, organizationId: created.id, role: OrganizationRole.OWNER },
      });
      return created;
    });

    return this.describe(organization.id);
  }

  async current(organizationId: string) {
    return this.describe(organizationId);
  }

  async rename(organizationId: string, dto: RenameOrganizationDto) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { name: dto.name },
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
      createdAt: organization.createdAt,
    };
  }
}
