import { periodAfter } from '../billing/billing-period';
import { freeTerms } from '../billing/scheduled-free';
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
  const plan = await effectiveLifetimePlan(tx, invitation.event.organizationId, now);
  const days = plan ? plan.invitationLifetimeDays : 90;
  await tx.invitation.update({ where: { id: invitationId }, data: { firstPublishedAt: now, lifetimeDays: days,
    lifetimeSource: plan ? 'PLAN' : 'FREE_DEFAULT', lifetimePlanKey: plan?.key ?? null,
    expiresAt: calculateInvitationExpiry(invitation.event, days), expiryProcessedAt: null } });
}

async function effectiveLifetimePlan(tx: Prisma.TransactionClient, organizationId: string, now: Date) {
  const subscription = await tx.subscription.findUnique({ where: { organizationId },
    select: { status: true, currentPeriodEnd: true, pendingFreeAt: true, pendingFreeTerms: true, activeFreeTerms: true,
      plan: { select: { key: true, invitationLifetimeDays: true } } } });
  if (!subscription) return null;
  if (subscription.pendingFreeAt && subscription.pendingFreeAt <= now) {
    const plan = freeTerms(subscription.pendingFreeTerms);
    return plan && periodAfter(plan.interval, subscription.pendingFreeAt).end > now ? plan : null;
  }
  if (subscription.status !== 'ACTIVE' || subscription.currentPeriodEnd <= now) return null;
  return freeTerms(subscription.activeFreeTerms) ?? subscription.plan;
}

export const LIFETIME_SELECT = { expiresAt: true, firstPublishedAt: true, lifetimeDays: true, lifetimeSource: true, lifetimePlanKey: true } as const;
export function hasInvitationExpired(invitation: { expiresAt: Date | null }, now = new Date()): boolean {
  return invitation.expiresAt !== null && invitation.expiresAt <= now;
}
