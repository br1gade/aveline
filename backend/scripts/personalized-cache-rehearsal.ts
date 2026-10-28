/** Local-only HTTP profile. Uses a guarded test database; never truncates it. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import Redis from 'ioredis';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/infra/cache/cache.service';
import { AnalyticsService } from '../src/infra/analytics/analytics.service';
import { InvitationsService } from '../src/modules/invitations/invitations.service';
import { compactGuestPageChanges } from '../src/modules/invitations/guest-page-version';
import { seedSeatingRehearsal } from '../test/fixtures/seating-rehearsal.fixture';
import { disconnectTestDatabase, testPrisma } from '../test/setup/test-database';

const locales = ['en', 'ru', 'fr', 'hy'];
async function measure(urls: string[]) {
  const samples = await Promise.all(urls.map(async (url) => {
    const start = performance.now();
    const response = await fetch(url); const page = await response.json() as { guest?: { seating?: unknown } };
    return { ms: performance.now() - start, isExpected: response.status === 200 && !!page.guest?.seating };
  }));
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const percentile = (fraction: number) => Math.round(times[Math.ceil(times.length * fraction) - 1] * 10) / 10;
  return { requests: samples.length, unexpected: samples.filter((sample) => !sample.isExpected).length,
    p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
}
async function main() {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const prisma = testPrisma();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', () => undefined); await new Promise<void>((resolve) => redis.once('ready', resolve));
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(prisma).overrideProvider(REDIS_CLIENT).useValue(redis)
    .overrideProvider(AnalyticsService).useValue({ recordInvitationView: async () => undefined, shutdown: async () => undefined, ensureIndexes: async () => undefined }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
  let eventId: string | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const event = await seedSeatingRehearsal(prisma, 'EVENT_WIDE'); eventId = event.eventId;
    await prisma.event.update({ where: { id: eventId }, data: { locales, seatingPublishedAt: new Date() } });
    const guests = await prisma.guest.findMany({ where: { eventId }, select: { id: true, token: true }, orderBy: { id: 'asc' } });
    const tables = await prisma.table.findMany({ where: { eventId }, orderBy: [{ venueId: 'asc' }, { name: 'asc' }] });
    await prisma.seat.createMany({ data: tables.flatMap((table, index) => guests.slice((index % 50) * 8, (index % 50 + 1) * 8)
      .map((guest, position) => ({ tableId: table.id, guestId: guest.id, position: position + 1 }))) });
    await prisma.$transaction((tx) => compactGuestPageChanges(tx));
    const base = await app.getUrl();
    const selected = guests.slice(0, 50);
    const urls = selected.map((guest, index) => `${base}/api/v1/invitations/${event.slug}/g/${guest.token}?locale=${locales[index % 4]}`);
    const service = app.get(InvitationsService);
    await Promise.all(selected.map((guest, index) => service.getPublicInvitation(event.slug, guest.token, locales[index % 4])));
    await measure(urls); await pause(1100);
    const warm = await measure(urls);
    await pause(1100);
    // A committed edit forces both cache layers cold without deleting other users' keys.
    await prisma.event.update({ where: { id: eventId }, data: { title: 'Cold profile' } });
    const cold = await measure(urls);
    await pause(1100); redis.disconnect();
    const degraded = await measure(urls);
    await redis.connect(); await pause(1100);
    const recovered = await measure(urls);
    console.log(JSON.stringify({ context: 'Local full Nest HTTP app; no proxy/TLS; analytics stubbed; standard throttles; 400 guests, 100 households, 2 venues, 800 seats; 50 simultaneous distinct guest/locale reads per phase', warm, cold, degraded, recovered }, null, 2));
    if ([warm, cold, degraded, recovered].some((result) => result.unexpected > 0)) process.exitCode = 1;
  } catch (error) {
    console.error({ stage: 'profile', name: (error as Error).name, detail: (error as { code?: string }).code, reason: (error as Error).message.split('\n').filter(Boolean)[0]?.slice(0, 160) });
    throw error;
  } finally {
    if (eventId) {
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
      await prisma.event.deleteMany({ where: { id: eventId } });
      if (event) await prisma.organization.delete({ where: { id: event.organizationId } });
    }
    try { await app.close(); } finally { redis.disconnect(); await disconnectTestDatabase(); }
  }
}
void main().then(() => process.exit(process.exitCode ?? 0)).catch((error: unknown) => {
  const failure = error as { name?: string; code?: string; message?: string };
  console.error({ name: failure.name, code: failure.code, message: failure.message?.split('\n').filter(Boolean)[0]?.replace(/(?:https?|postgresql):\/\/[^ ]+/g, '[redacted]').slice(0, 200) });
  process.exit(1);
});
