import { OrganizationRole, Prisma } from '@prisma/client';
import { cursorPage, readDatedCursor } from '../../common/cursor-pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { liveOwnerInvites } from './concierge-relationship';
import { FindOrganizationsPageQuery } from './dto/concierge.dto';

export function customerOrganizationSelect() {
  return {
    id: true, name: true, kind: true, createdAt: true,
    memberships: { where: { role: OrganizationRole.OWNER }, select: { user: { select: { email: true } } } },
    invites: { where: liveOwnerInvites(), select: { email: true } },
    _count: { select: { events: true } },
  } satisfies Prisma.OrganizationSelect;
}

type CustomerOrganization = Prisma.OrganizationGetPayload<{ select: ReturnType<typeof customerOrganizationSelect> }>;

export function describeCustomerOrganization({ memberships, invites, _count, ...organization }: CustomerOrganization) {
  return {
    ...organization,
    events: _count.events,
    owners: memberships.map((membership) => membership.user.email),
    pendingOwnerInvites: invites.map((invite) => invite.email),
  };
}

export async function findOrganizationsPage(prisma: PrismaService, query: FindOrganizationsPageQuery) {
  const filters = { domain: 'concierge-organizations', search: query.search?.toLowerCase() ?? '' };
  const cursor = readDatedCursor(query.cursor, filters);
  const after: Prisma.OrganizationWhereInput = cursor
    ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {};
  const rows = await prisma.organization.findMany({
    where: { deletedAt: null, name: query.search ? { contains: query.search, mode: 'insensitive' } : undefined, ...after },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, select: customerOrganizationSelect(),
  });
  const page = cursorPage(rows, query.limit, filters, (row) => ({ id: row.id, at: row.createdAt }));
  return { ...page, items: page.items.map(describeCustomerOrganization) };
}
