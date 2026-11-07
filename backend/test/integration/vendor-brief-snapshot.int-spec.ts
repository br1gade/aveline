import { ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { VendorBriefsService } from '../../src/modules/vendors/vendor-briefs.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('vendor brief read consistency', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const reader = (client: unknown = prisma) => new VendorBriefsService(client as PrismaService,
    new OperationsService(prisma, {} as AnalyticsService));

  const bookingFor = async (scope: 'seating' | 'contacts') => {
    const { eventId } = await seedEvent(prisma);
    const vendor = await prisma.vendor.create({ data: { name: 'Fixture vendor', category: 'VENUE' } });
    const booking = await prisma.vendorBooking.create({ data: { eventId, vendorId: vendor.id,
      briefScopes: [scope], briefToken: 'isolated-snapshot-fixture-token' } });
    return { eventId, booking };
  };

  /** Commit the later state after the old capability lookup has completed. */
  const pauseAfterLookup = (bookingId: string, later: Prisma.PrismaPromise<unknown>) => prisma.$extends({
    query: { vendorBooking: { async findUnique({ args, query }) {
      const initial = await query(args);
      await prisma.$transaction([
        prisma.vendorBooking.update({ where: { id: bookingId }, data: { isBriefEnabled: false } }), later,
      ]);
      return initial;
    } } },
  });

  it('does not expose seating published after the capability was paused', async () => {
    const { eventId, booking } = await bookingFor('seating');
    await prisma.table.create({ data: { eventId, name: 'Never published while accessible', capacity: 4 } });
    const client = pauseAfterLookup(booking.id, prisma.event.update({ where: { id: eventId },
      data: { seatingPublishedAt: new Date('2026-11-01T12:00:00Z') } }));
    const response = await reader(client).findByToken(booking.briefToken);
    expect(response.granted).toEqual([]);
    expect(response.seating).toBeUndefined();
    await expect(reader().findByToken(booking.briefToken)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose contact edits committed after the capability was paused', async () => {
    const { eventId, booking } = await bookingFor('contacts');
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId }, select: { id: true } });
    await prisma.guest.update({ where: { id: guest.id }, data: { phone: '+37499111222', rsvp: { update: { status: 'ATTENDING' } } } });
    const client = pauseAfterLookup(booking.id, prisma.guest.update({ where: { id: guest.id }, data: { phone: '+37499333444' } }));
    const response = await reader(client).findByToken(booking.briefToken);
    expect(response.contacts).toEqual([expect.objectContaining({ phone: '+37499111222' })]);
    await expect(reader().findByToken(booking.briefToken)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
