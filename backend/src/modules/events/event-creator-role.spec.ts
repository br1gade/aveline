import { ForbiddenException } from '@nestjs/common';
import { EventRole, OrganizationRole, Prisma } from '@prisma/client';
import { resolveEventCreatorRole } from './event-creator-role';

describe('event creator standing', () => {
  it.each([
    [OrganizationRole.OWNER, EventRole.OWNER],
    [OrganizationRole.MANAGER, EventRole.COORDINATOR],
    [OrganizationRole.MEMBER, EventRole.COORDINATOR],
  ])('uses only the target organization role %s', async (role, expected) => {
    const findUnique = jest.fn().mockResolvedValue({ role });
    const findFirst = jest.fn().mockResolvedValue({ role: OrganizationRole.OWNER });
    const tx = { organizationMembership: { findUnique, findFirst } } as unknown as Prisma.TransactionClient;
    await expect(resolveEventCreatorRole(tx, { userId: 'customer', organizationId: 'selected' }))
      .resolves.toBe(expected);
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 'customer', organizationId: 'selected' } },
      select: { role: true },
    });
  });

  it('refuses ownership when the creator has no membership in the target tenant', async () => {
    const tx = { organizationMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ role: OrganizationRole.OWNER }),
    } } as unknown as Prisma.TransactionClient;
    await expect(resolveEventCreatorRole(tx, { userId: 'customer', organizationId: 'foreign' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
