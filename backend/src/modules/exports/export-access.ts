import { lockEventOrganization, requireCurrentEventPermission } from '../../infra/auth/access-locks';
import { Prisma } from '@prisma/client';
import { actorCan } from '../../infra/auth/actor';

/** Work and downloads use current database standing, never roles saved in a job. */
export async function exportAccess(tx: Prisma.TransactionClient, eventId: string, userId: string) {
  const actor = await requireCurrentEventPermission(tx, { eventId, actor: { userId }, permission: 'operations:read' });
  return { canSeeContacts: actorCan(actor, 'guest:contact:read') };
}

/** Transactional queue/capture/publish fence; download uses separate post-I/O checks. */
export async function lockExportAccess(tx: Prisma.TransactionClient, eventId: string, userId: string) {
  await lockEventOrganization(tx, eventId);
  return exportAccess(tx, eventId, userId);
}
