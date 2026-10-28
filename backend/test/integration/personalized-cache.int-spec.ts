import { readGuestPageMeta } from '../../src/modules/invitations/guest-page-version';
import { GuestProjectionReader } from '../../src/modules/invitations/guest-projection';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { CacheService } from '../../src/infra/cache/cache.service';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { InvitationsService } from '../../src/modules/invitations/invitations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../setup/test-database';

describe('Authoritative personalized cache (integration)', () => {
  let prisma: PrismaClient; let redis: Redis; let cache: CacheService; let invitations: InvitationsService;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined); await new Promise<void>((resolve) => redis.once('ready', resolve));
    cache = new CacheService(redis);
    invitations = new InvitationsService(prisma as unknown as PrismaService, cache, { recordInvitationView: jest.fn() } as unknown as AnalyticsService,
      new ConfigService({ INVITATION_CACHE_TTL: '60', TELEGRAM_BOT_USERNAME: 'FixtureBot' }));
  });
  afterEach(async () => { jest.restoreAllMocks(); await cache.disconnect(); });
  afterAll(() => disconnectTestDatabase());
  const setup = async () => {
    const event = await seedEvent(prisma, { visibility: 'UNLISTED' });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    return { ...event, guest };
  };
  it('reuses the actual projection snapshot when RSVP commits between the initial check and projection load', async () => {
    const event = await setup();
    const second = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Second', token: randomUUID(), rsvp: { create: {} } } });
    jest.spyOn(redis, 'get').mockResolvedValue(null);
    const raw = prisma.$queryRaw.bind(prisma);
    let projections = 0;
    jest.spyOn(prisma, '$queryRaw').mockImplementation((query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const text = Array.isArray(query) ? query.join('') : (query as { sql: string }).sql;
      return (async () => {
        if (text.includes('WITH event_scope AS MATERIALIZED')) {
          projections += 1;
          if (projections === 1) await prisma.rsvp.update({ where: { guestId: event.guest.id }, data: { status: 'ATTENDING' } });
        }
        return raw(query, ...values);
      })() as never;
    });
    const [first, other] = await Promise.all([
      invitations.getPublicInvitation(event.slug, event.primaryGuestToken), invitations.getPublicInvitation(event.slug, second.token),
    ]);
    expect(first.guest?.rsvp?.status).toBe('ATTENDING'); expect(other.guest?.id).toBe(second.id);
    expect(projections).toBe(1);
  });
  it('stamps batched household data with its committed revisions and preserves UTC history', async () => {
    const event = await setup();
    const timestamp = new Date('2026-10-24T12:34:56.000Z');
    const second = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Second', token: randomUUID() } });
    const erased = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Erased', token: randomUUID(), anonymizedAt: timestamp } });
    const unrelated = await seedEvent(prisma);
    const outsider = await prisma.guest.findUniqueOrThrow({ where: { token: unrelated.primaryGuestToken } });
    const preparation = await prisma.venue.create({ data: { eventId: event.eventId, role: 'PREPARATION', name: 'Private preparation', address: 'Internal' } });
    const internal = await prisma.venue.create({ data: { eventId: event.eventId, role: 'OTHER', name: 'Internal only', address: 'Internal' } });
    await prisma.timelineEntry.create({ data: { eventId: event.eventId, venueId: internal.id, label: { en: 'Internal' }, occursAt: timestamp, isInternal: true } });
    await prisma.event.update({ where: { id: event.eventId }, data: { seatingPublishedAt: timestamp } });
    await prisma.rsvp.update({ where: { guestId: event.guest.id }, data: { status: 'ATTENDING', respondedAt: timestamp } });
    await prisma.attendanceResponse.create({ data: { eventId: event.eventId, guestId: event.guest.id, revision: 1, scopeId: 'event', status: 'ATTENDING', respondedAt: timestamp } });
    const reader = new GuestProjectionReader(prisma);
    const loaded = await Promise.all([event.guest, second, erased, outsider].map((member) => reader.read(event.eventId, member.id)));
    const [meta] = await readGuestPageMeta(prisma, event.slug, event.primaryGuestToken);
    const own = loaded.find((guest) => guest?.id === event.guest.id)!;
    expect(own.payloadRevision).toBe(`${meta.sharedRevision}:${event.householdId}:${meta.personalRevision}`);
    expect(own.rsvp?.respondedAt).toEqual(timestamp);
    expect(own.attendanceResponses[0].respondedAt).toEqual(timestamp);
    expect(own.event.seatingPublishedAt).toEqual(timestamp);
    expect(own.event.venues.map((venue) => venue.id)).not.toEqual(expect.arrayContaining([preparation.id, internal.id]));
    expect(own.event.venues).toHaveLength(1);
    expect(loaded.slice(2)).toEqual([null, null]);
    expect(own.household.guests).toHaveLength(2);
    expect(own.household.guests.every((member) => !Object.hasOwn(member, 'token') && !Object.hasOwn(member, 'email'))).toBe(true);
  });
  it('does not reuse a former household when a move lands on an equal counter value', async () => {
    const event = await setup();
    const household = await prisma.household.create({ data: { eventId: event.eventId, name: 'New household', seatsAllotted: 1 } });
    const before = await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    expect(before.guest?.household.name).toBe('Fixture Household');
    await prisma.guest.update({ where: { id: event.guest.id }, data: { householdId: household.id } });
    const after = await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    expect(after.guest?.household.name).toBe('New household');
    expect(after.guest?.household.members.map((member) => member.id)).toEqual([event.guest.id]);
  });
  it('keeps unrelated households and shared content warm when another household answers', async () => {
    const event = await setup();
    const household = await prisma.household.create({ data: { eventId: event.eventId, name: 'Unrelated', seatsAllotted: 1 } });
    const other = await prisma.guest.create({ data: { eventId: event.eventId, householdId: household.id, firstName: 'Other', token: randomUUID() } });
    await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    await invitations.getPublicInvitation(event.slug, other.token);
    const shared = jest.spyOn(prisma.invitation, 'findUnique');
    const personal = jest.spyOn(prisma.guest, 'findFirst');
    await prisma.rsvp.update({ where: { guestId: event.guest.id }, data: { status: 'DECLINED' } });
    expect((await invitations.getPublicInvitation(event.slug, other.token)).guest?.id).toBe(other.id);
    expect(shared).not.toHaveBeenCalled(); expect(personal).not.toHaveBeenCalled();
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.rsvp?.status).toBe('DECLINED');
  });
  it('loads a cold personalized screen in four database statements rather than relation round trips', async () => {
    const event = await setup();
    const reader = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } }, log: [{ emit: 'event', level: 'query' }] });
    await reader.$connect();
    let statements = 0;
    reader.$on('query', () => { statements += 1; });
    const service = new InvitationsService(reader as unknown as PrismaService, cache, { recordInvitationView: jest.fn() } as unknown as AnalyticsService, new ConfigService({}));
    try {
      const page = await service.getPublicInvitation(event.slug, event.primaryGuestToken);
      expect(page.guest?.id).toBe(event.guest.id);
      expect(statements).toBeLessThanOrEqual(4);
    } finally { await reader.$disconnect(); }
  });
  it('reuses the expensive personal projection while validating the capability on every read', async () => {
    const event = await setup(); const reads = jest.spyOn(prisma.guest, 'findFirst');
    await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    expect(reads.mock.calls.filter(([args]) => args?.select?.household !== undefined)).toHaveLength(1);
    await prisma.guest.update({ where: { id: event.guest.id }, data: { token: randomUUID() } });
    await expect(invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).rejects.toThrow('available');
  });
  it('never puts bearer links or guest tokens in cache keys or projections', async () => {
    const event = await setup(); const set = jest.spyOn(redis, 'set'); const evalScript = jest.spyOn(redis, 'eval');
    const page = await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    expect(page.guest?.telegramLink).toContain(event.primaryGuestToken);
    const writes = JSON.stringify([...set.mock.calls, ...evalScript.mock.calls]);
    expect(writes).not.toContain(event.primaryGuestToken); expect(writes).not.toContain('https://t.me/');
  });
  it('does not revive a stale name when Redis recovers after a missed invalidation', async () => {
    const event = await setup(); await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    const disconnected = jest.spyOn(redis, 'get').mockRejectedValue(new Error('Redis unavailable'));
    await prisma.guest.update({ where: { id: event.guest.id }, data: { firstName: 'Corrected' } });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.name).toBe('Corrected Guest');
    disconnected.mockRestore();
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.name).toBe('Corrected Guest');
  });
  it('rechecks expiry and erasure even with a warm cached personal page', async () => {
    const event = await setup(); await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    await prisma.invitation.update({ where: { slug: event.slug }, data: { expiresAt: new Date(0) } });
    await expect(invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).rejects.toThrow('available');
    await prisma.invitation.update({ where: { slug: event.slug }, data: { expiresAt: null } });
    await prisma.guest.update({ where: { id: event.guest.id }, data: { anonymizedAt: new Date() } });
    await expect(invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).rejects.toThrow('available');
  });
  it('sees raw SQL seating/RSVP and template writes without application invalidation', async () => {
    const event = await setup(); await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    await invitations.getCachedInvitation(event.slug, 'en');
    await prisma.$executeRaw`UPDATE rsvps SET status = 'ATTENDING' WHERE "guestId" = ${event.guest.id}`;
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    await prisma.designTemplate.update({ where: { id: invitation.templateId }, data: { defaultTheme: { primary: '#123456' } } });
    const page = await invitations.getPublicInvitation(event.slug, event.primaryGuestToken, 'en');
    expect(page.guest?.rsvp?.status).toBe('ATTENDING'); expect(page.theme).toMatchObject({ primary: '#123456' });
  });
  it('falls back with both Redis reads and writes disconnected, then recovers without stale data', async () => {
    const event = await setup(); await invitations.getPublicInvitation(event.slug, event.primaryGuestToken);
    redis.disconnect();
    await prisma.household.update({ where: { id: event.householdId }, data: { name: 'Changed offline' } });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.household.name).toBe('Changed offline');
    await redis.connect();
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.household.name).toBe('Changed offline');
  });
  it('isolates people and negotiated languages and removes erased household members', async () => {
    const event = await setup();
    const other = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName: 'Other', token: randomUUID() } });
    const unrelated = await seedEvent(prisma);
    const [primary, translated] = await Promise.all([
      invitations.getPublicInvitation(event.slug, event.primaryGuestToken, 'en'),
      invitations.getPublicInvitation(event.slug, other.token, 'hy'),
      expect(invitations.getPublicInvitation(event.slug, unrelated.primaryGuestToken)).rejects.toThrow('available'),
    ]);
    expect(primary.locale).toBe('en'); expect(translated.locale).toBe('hy');
    expect(primary.guest?.name).toBe('Primary Guest'); expect(translated.guest?.name).toBe('Other');
    expect(primary.guest?.household.members).toHaveLength(2);
    await prisma.guest.update({ where: { id: other.id }, data: { anonymizedAt: new Date() } });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken, 'en')).guest?.household.members).toHaveLength(1);
  });
  it('retries an in-flight stale projection after a concurrent name change', async () => {
    const event = await setup(); const readThrough = cache.readThrough.bind(cache);
    const read = jest.spyOn(cache, 'readThrough').mockImplementation(async (key, ttl, load) => {
      const old = await readThrough(key, ttl, load);
      if (!key.includes(':personal:')) return old;
      read.mockRestore();
      await prisma.guest.update({ where: { id: event.guest.id }, data: { firstName: 'Concurrent' } });
      return old;
    });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.name).toBe('Concurrent Guest');
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.name).toBe('Concurrent Guest');
  });
  it('denies erasure committed while a cached projection is loading', async () => {
    const event = await setup(); const readThrough = cache.readThrough.bind(cache);
    jest.spyOn(cache, 'readThrough').mockImplementation(async (key, ttl, load) => {
      const old = await readThrough(key, ttl, load);
      if (!key.includes(':personal:')) return old;
      await prisma.guest.update({ where: { id: event.guest.id }, data: { anonymizedAt: new Date() } });
      return old;
    });
    await expect(invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).rejects.toThrow('available');
  });

  it('refreshes published seating and hides it after a venue becomes internal', async () => {
    const event = await setup();
    const venue = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    const table = await prisma.table.create({ data: { eventId: event.eventId, venueId: venue.id, name: 'Original table', capacity: 8 } });
    await prisma.seat.create({ data: { tableId: table.id, guestId: event.guest.id } });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.seating).toBeNull();
    await prisma.event.update({ where: { id: event.eventId }, data: { seatingPublishedAt: new Date() } });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.seating?.table).toBe('Original table');
    await prisma.table.update({ where: { id: table.id }, data: { name: 'Corrected table' } });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.seating?.table).toBe('Corrected table');
    await prisma.venue.update({ where: { id: venue.id }, data: { role: 'PREPARATION' } });
    expect((await invitations.getPublicInvitation(event.slug, event.primaryGuestToken)).guest?.seating?.assignments).toEqual([]);
  });
  it('refreshes shared copy and household membership without cache deletion', async () => {
    const event = await setup(); await invitations.getPublicInvitation(event.slug, event.primaryGuestToken, 'en');
    const block = await prisma.invitationBlock.findFirstOrThrow({ where: { invitation: { eventId: event.eventId }, type: 'HERO' } });
    await prisma.invitationBlock.update({ where: { id: block.id }, data: { content: { en: { title: 'Revised hero' } } } });
    const household = await prisma.household.create({ data: { eventId: event.eventId, name: 'Moved household', seatsAllotted: 2 } });
    await prisma.guest.update({ where: { id: event.guest.id }, data: { householdId: household.id } });
    const page = await invitations.getPublicInvitation(event.slug, event.primaryGuestToken, 'en');
    expect(page.guest?.household.name).toBe('Moved household');
    expect(page.blocks.find((item) => item.type === 'HERO')?.content).toEqual({ title: 'Revised hero' });
  });

  it('does not reuse another event’s shared payload when a deleted slug is assigned again', async () => {
    const original = await setup(); const replacement = await setup();
    await prisma.event.update({ where: { id: original.eventId }, data: { title: 'Original event' } });
    await prisma.event.update({ where: { id: replacement.eventId }, data: { title: 'Replacement event' } });
    await prisma.guest.update({ where: { id: original.guest.id }, data: { firstName: 'Older' } });
    const before = (await readGuestPageMeta(prisma, original.slug))[0].revision;
    await invitations.getCachedInvitation(original.slug, 'en');
    await prisma.event.delete({ where: { id: original.eventId } });
    await prisma.invitation.update({ where: { slug: replacement.slug }, data: { slug: original.slug } });
    expect((await readGuestPageMeta(prisma, original.slug))[0].revision).toBe(before);
    expect((await invitations.getCachedInvitation(original.slug, 'en')).event.title).toBe('Replacement event');
  });

});
