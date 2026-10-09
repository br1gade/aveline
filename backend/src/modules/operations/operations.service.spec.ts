import { Test } from '@nestjs/testing';
import { RsvpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../../infra/analytics/analytics.service';
import { OperationsService } from './operations.service';

/**
 * These cover the derivations that the product thesis rests on: guest answers
 * given once must aggregate correctly into the operational sheets.
 */
describe('OperationsService', () => {
  let service: OperationsService;
  let analytics: { invitationViewSummary: jest.Mock };
  let prisma: {
    event: { findUnique: jest.Mock };
    guest: { findMany: jest.Mock };
    household: { count: jest.Mock };
    rsvp: { findMany: jest.Mock; groupBy: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      event: { findUnique: jest.fn().mockResolvedValue({ id: 'e1' }) },
      guest: { findMany: jest.fn() },
      household: { count: jest.fn().mockResolvedValue(2) },
      rsvp: { findMany: jest.fn(), groupBy: jest.fn() },
      // Household counts and the trend are SQL; their numbers are checked in
      // the integration suite against a real Postgres.
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    analytics = {
      invitationViewSummary: jest.fn().mockResolvedValue({ totalViews: 0, byLocale: [] }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OperationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compile();

    service = moduleRef.get(OperationsService);
  });

  describe('headcount', () => {
    it('tallies responses and computes response rate', async () => {
      const responded = new Date();
      prisma.guest.findMany.mockResolvedValue([
        { attribution: 'SIDE_A', rsvp: { status: RsvpStatus.ATTENDING, respondedAt: responded } },
        { attribution: 'SIDE_A', rsvp: { status: RsvpStatus.ATTENDING, respondedAt: responded } },
        { attribution: 'SIDE_B', rsvp: { status: RsvpStatus.ATTENDING, respondedAt: responded } },
        { attribution: 'SIDE_B', rsvp: { status: RsvpStatus.DECLINED, respondedAt: responded } },
        { attribution: 'SIDE_B', rsvp: null },
      ]);

      const result = await service.headcount('e1');

      expect(result.invited).toBe(5);
      expect(result.attending).toBe(3);
      expect(result.declined).toBe(1);
      expect(result.pending).toBe(1);
      expect(result.responseRate).toBe(80);
      expect(result.bySide).toContainEqual(expect.objectContaining({ side: 'SIDE_A', invited: 2, attending: 2 }));
      expect(result.bySide).toContainEqual(
        expect.objectContaining({ side: 'SIDE_B', invited: 3, attending: 1, declined: 1, pending: 1 }),
      );
    });

    it('reports a zero response rate for an event with no guests', async () => {
      prisma.guest.findMany.mockResolvedValue([]);
      await expect(service.headcount('e1')).resolves.toMatchObject({
        invited: 0,
        responseRate: 0,
      });
    });
  });

  describe('cateringSheet', () => {
    it('counts covers and aggregates dietary requirements', async () => {
      prisma.guest.findMany.mockResolvedValue([
        {
          firstName: 'A',
          lastName: 'X',
          household: { name: 'H1' },
          rsvp: { dietary: ['vegetarian'], dietaryNotes: null },
        },
        {
          firstName: 'B',
          lastName: 'Y',
          household: { name: 'H2' },
          rsvp: { dietary: ['vegetarian', 'nut-free'], dietaryNotes: 'severe' },
        },
      ]);

      const sheet = await service.cateringSheet('e1');

      expect(sheet.covers).toBe(2);
      expect(sheet.requirements[0]).toEqual({ requirement: 'vegetarian', key: 'vegetarian', count: 2 });
      expect(sheet.requirements).toContainEqual({ requirement: 'nut-free', key: 'nut-free', count: 1 });
      expect(sheet.notes).toEqual([{ guest: 'B Y', household: 'H2', note: 'severe' }]);
    });
  });

  describe('barSheet', () => {
    it('converts preferences into quantities and shares', async () => {
      prisma.rsvp.groupBy.mockResolvedValue([
        { drinkPreference: 'wine', _count: { drinkPreference: 3 } },
        { drinkPreference: 'cognac', _count: { drinkPreference: 1 } },
      ]);

      const sheet = await service.barSheet('e1');

      expect(sheet.totalResponses).toBe(4);
      expect(sheet.preferences[0]).toEqual({ drink: 'wine', key: 'wine', guests: 3, share: 75 });
    });

    // With fixed choices, guests send a key; the bar reads the label.
    it('shows a configured choice by its label in the event’s language', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'e1',
        defaultLocale: 'en',
        invitation: { rsvpFields: { drinkPreference: { isEnabled: true, options: [{ key: 'wine', label: { en: 'Wine' } }] } } },
      });
      prisma.rsvp.groupBy.mockResolvedValue([{ drinkPreference: 'wine', _count: { drinkPreference: 2 } }]);

      const sheet = await service.barSheet('e1');

      expect(sheet.preferences[0]).toEqual({ drink: 'Wine', key: 'wine', guests: 2, share: 100 });
    });
  });

  describe('dashboard', () => {
    // The product rule in spec §12: a screen is one request, and one store
    // being down degrades the screen rather than failing it.
    it('returns every operational view in a single call', async () => {
      prisma.guest.findMany.mockResolvedValue([]);
      prisma.rsvp.groupBy.mockResolvedValue([]);
      prisma.rsvp.findMany.mockResolvedValue([]);

      const result = await service.dashboard('e1');

      expect(Object.keys(result).sort()).toEqual([
        'bar',
        'catering',
        'engagement',
        'generatedAt',
        'headcount',
        'playlist',
      ]);
    });

    it('still renders when analytics returns nothing', async () => {
      prisma.guest.findMany.mockResolvedValue([]);
      prisma.rsvp.groupBy.mockResolvedValue([]);
      prisma.rsvp.findMany.mockResolvedValue([]);
      analytics.invitationViewSummary.mockResolvedValue({ totalViews: 0, byLocale: [] });

      await expect(service.dashboard('e1')).resolves.toMatchObject({
        engagement: { totalViews: 0, byLocale: [] },
      });
    });

    it('runs its independent queries concurrently, not in sequence', async () => {
      prisma.guest.findMany.mockResolvedValue([]);
      prisma.rsvp.groupBy.mockResolvedValue([]);
      prisma.rsvp.findMany.mockResolvedValue([]);

      await service.dashboard('e1');

      // guest.findMany backs both headcount and the catering sheet; if the
      // sheets were awaited one after another the event check would repeat
      // serially. Both sheets issued means they were dispatched together.
      expect(prisma.guest.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.rsvp.groupBy).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown event before doing any work', async () => {
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.dashboard('nope')).rejects.toThrow('No event nope');
      expect(prisma.guest.findMany).not.toHaveBeenCalled();
    });
  });

  it('rejects an unknown event', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.headcount('nope')).rejects.toThrow('No event nope');
  });
});
