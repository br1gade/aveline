import { Prisma } from '@prisma/client';

const DAY_MS = 86_400_000;
export function calculateInvitationExpiry(event: { startsAt: Date; endsAt: Date | null }, days: number | null): Date | null {
  return days === null ? null : new Date((event.endsAt ?? event.startsAt).getTime() + days * DAY_MS);
}

/** Capture once; later subscription/catalog edits do not rewrite this entitlement. */
export async function captureInvitationLifetime(tx: Prisma.TransactionClient, invitationId: string) {
  const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: invitationId },
    select: { lifetimeSource: true, status: true, event: { select: { startsAt: true, endsAt: true, organizationId: true } } } });
  if (invitation.lifetimeSource) return;
  if (invitation.status !== 'DRAFT') {
    await tx.invitation.update({ where: { id: invitationId }, data: { lifetimeSource: 'LEGACY' } });
    return;
  }
  const now = new Date();
  const subscription = await tx.subscription.findFirst({ where: { organizationId: invitation.event.organizationId,
    status: 'ACTIVE', currentPeriodEnd: { gt: now } }, select: { plan: { select: { key: true, invitationLifetimeDays: true } } } });
  const days = subscription ? subscription.plan.invitationLifetimeDays : 90;
  await tx.invitation.update({ where: { id: invitationId }, data: { firstPublishedAt: now, lifetimeDays: days,
    lifetimeSource: subscription ? 'PLAN' : 'FREE_DEFAULT', lifetimePlanKey: subscription?.plan.key ?? null,
    expiresAt: calculateInvitationExpiry(invitation.event, days), expiryProcessedAt: null } });
}

export const LIFETIME_SELECT = { expiresAt: true, firstPublishedAt: true, lifetimeDays: true, lifetimeSource: true, lifetimePlanKey: true } as const;
export function hasInvitationExpired(invitation: { expiresAt: Date | null }, now = new Date()): boolean {
  return invitation.expiresAt !== null && invitation.expiresAt <= now;
}
