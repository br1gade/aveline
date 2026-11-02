import { OrganizationRole, Prisma } from '@prisma/client';

interface OrganizationAccessChangeInput {
  organizationId: string;
  actorUserId: string;
  subjectUserId?: string;
  action: 'CREATED' | 'JOINED' | 'ROLE_CHANGED' | 'REMOVED' | 'LEFT' | 'REVIEW_HANDOVER' | 'REVIEW_CLOSE' | 'REVIEW_DECLINE';
  previousRole?: OrganizationRole;
  role?: OrganizationRole;
  accessRevision: number;
  revokedEventRoles?: number;
}

/** Authority changes and their minimal evidence succeed or roll back together. */
export function recordOrganizationAccessChange(tx: Prisma.TransactionClient, input: OrganizationAccessChangeInput) {
  return tx.organizationAccessChange.create({ data: input, select: { id: true } });
}
