import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PublishingService } from '../../src/modules/invitations/publishing.service';
import { InvitationMaintenanceService } from '../../src/modules/invitations/invitation-maintenance.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Captured invitation entitlements (integration)', () => {
  let prisma: PrismaClient; let publishing: PublishingService; let maintenance: InvitationMaintenanceService;
  beforeAll(() => {
    prisma = testPrisma(); const database = prisma as unknown as PrismaService;
    publishing = new PublishingService(database, { invalidateInvitation: jest.fn() } as unknown as CacheService);
    maintenance = new InvitationMaintenanceService(database);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());
  const setup = async () => {
    const event = await seedEvent(prisma, { isPublished: false });
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.eventId } });
    return { ...event, organizationId: row.organizationId, startsAt: row.startsAt };
  };
  const subscribe = async (event: Awaited<ReturnType<typeof setup>>, days: number | null, status: 'ACTIVE' | 'EXPIRED' | 'TRIALING' = 'ACTIVE') => {
    const plan = await prisma.plan.create({ data: { key: randomUUID(), name: 'Fixture plan', tier: 'MANAGED', priceMinor: 10000n, interval: 'MONTHLY', invitationLifetimeDays: days } });
    await prisma.subscription.create({ data: { organizationId: event.organizationId, planId: plan.id, status, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) } });
    return plan;
  };
  it('uses start without end and captures the free fallback even without seeded plans', async () => {
    const event = await setup(); const published = await publishing.publish(event.slug);
    expect(published).toMatchObject({ lifetimeDays: 90, lifetimeSource: 'FREE_DEFAULT', lifetimePlanKey: null });
    expect(published.expiresAt).toEqual(new Date(event.startsAt.getTime() + 90 * 86_400_000));
  });
  it('preserves an indefinite paid snapshot through subscription cancellation and catalogue edits', async () => {
    const event = await setup(); const plan = await subscribe(event, null); const first = await publishing.publish(event.slug);
    expect(first).toMatchObject({ lifetimeSource: 'PLAN', lifetimePlanKey: plan.key, lifetimeDays: null, expiresAt: null });
    await prisma.plan.update({ where: { id: plan.id }, data: { invitationLifetimeDays: 7 } });
    await prisma.subscription.update({ where: { organizationId: event.organizationId }, data: { status: 'CANCELLED' } });
    await publishing.close(event.slug); const next = await publishing.reopen(event.slug);
    expect(next.expiresAt).toBeNull(); expect(next.firstPublishedAt).toEqual(first.firstPublishedAt);
  });
  it('recomputes from captured finite days rather than an edited plan, including raw SQL date writes', async () => {
    const event = await setup(); const plan = await subscribe(event, 30); await publishing.publish(event.slug);
    await prisma.plan.update({ where: { id: plan.id }, data: { invitationLifetimeDays: 3 } });
    const endsAt = new Date(event.startsAt.getTime() + 2 * 86_400_000);
    await prisma.$executeRaw`UPDATE events SET "endsAt" = ${endsAt} WHERE id = ${event.eventId}`;
    const row = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    expect(row.lifetimeDays).toBe(30); expect(row.expiresAt).toEqual(new Date(endsAt.getTime() + 30 * 86_400_000));
  });
  it('does not grant a lapsed paid subscription an indefinite new invitation', async () => {
    const event = await setup(); await subscribe(event, null, 'EXPIRED');
    expect(await publishing.publish(event.slug)).toMatchObject({ lifetimeSource: 'FREE_DEFAULT', lifetimeDays: 90 });
  });
  it('does not treat a legacy unpaid TRIALING intent as an active paid entitlement', async () => {
    const event = await setup(); await subscribe(event, null, 'TRIALING');
    expect(await publishing.publish(event.slug)).toMatchObject({ lifetimeSource: 'FREE_DEFAULT', lifetimeDays: 90 });
  });
  it('does not capture a subscription whose active period already ended', async () => {
    const event = await setup(); await subscribe(event, null);
    await prisma.subscription.update({ where: { organizationId: event.organizationId }, data: { currentPeriodStart: new Date(-86_400_000), currentPeriodEnd: new Date(0) } });
    expect(await publishing.publish(event.slug)).toMatchObject({ lifetimeSource: 'FREE_DEFAULT', lifetimeDays: 90 });
  });
  it.each([null, new Date('2027-01-01T00:00:00Z')])('preserves ambiguous legacy access %s and reports it for review', async (expiresAt) => {
    const event = await setup(); await prisma.invitation.update({ where: { slug: event.slug }, data: { status: 'CLOSED', expiresAt } });
    const reopened = await publishing.reopen(event.slug);
    expect(reopened).toMatchObject({ lifetimeSource: 'LEGACY', firstPublishedAt: null, expiresAt });
    await prisma.event.update({ where: { id: event.eventId }, data: { endsAt: new Date(event.startsAt.getTime() + 86_400_000) } });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } })).expiresAt).toEqual(expiresAt);
    expect(await maintenance.maintain()).toMatchObject({ legacyInvitations: 1 });
  });
  it('marks expiry once without closing host data and rearms after a date correction', async () => {
    const event = await setup(); await publishing.publish(event.slug);
    await prisma.invitation.update({ where: { slug: event.slug }, data: { expiresAt: new Date(0) } });
    expect(await maintenance.maintain()).toMatchObject({ expiriesProcessed: 1 });
    expect(await maintenance.maintain()).toMatchObject({ expiriesProcessed: 0 });
    expect(await prisma.invitation.findUnique({ where: { slug: event.slug } })).toMatchObject({ status: 'PUBLISHED', expiryProcessedAt: expect.any(Date) });
    expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(1);
    await prisma.event.update({ where: { id: event.eventId }, data: { endsAt: new Date(event.startsAt.getTime() + 86_400_000) } });
    expect(await prisma.invitation.findUnique({ where: { slug: event.slug } })).toMatchObject({ expiryProcessedAt: null, expiresAt: expect.any(Date) });
  });
  it('bounds each expiry maintenance batch to one hundred invitations', async () => {
    const event = await setup(); const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    const ids = Array.from({ length: 101 }, () => randomUUID());
    await prisma.event.createMany({ data: ids.map((id) => ({ id, organizationId: event.organizationId, type: 'OTHER' as const, title: 'Expiry fixture', hostsLabel: 'Host', startsAt: event.startsAt })) });
    await prisma.invitation.createMany({ data: ids.map((id) => ({ eventId: id, templateId: invitation.templateId, slug: randomUUID(), status: 'PUBLISHED' as const, expiresAt: new Date(0), lifetimeSource: 'LEGACY' as const })) });
    expect(await maintenance.maintain()).toMatchObject({ expiriesProcessed: 100 });
    expect(await maintenance.maintain()).toMatchObject({ expiriesProcessed: 1 });
    expect(await prisma.invitation.count({ where: { expiryProcessedAt: { not: null } } })).toBe(101);
  });
});
