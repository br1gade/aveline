import { Test } from '@nestjs/testing';
import { RsvpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationsService } from './operations.service';

/**
 * These cover the derivations that the product thesis rests on: guest answers
 * given once must aggregate correctly into the operational sheets.
 */
describe('OperationsService', () => {
  let service: OperationsService;
  let prisma: {
    event: { findUnique: jest.Mock };
    guest: { findMany: jest.Mock };
    household: { count: jest.Mock };
    rsvp: { findMany: jest.Mock; groupBy: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      event: { findUnique: jest.fn().mockResolvedValue({ id: 'e1' }) },
      guest: { findMany: jest.fn() },
      household: { count: jest.fn().mockResolvedValue(2) },
      rsvp: { findMany: jest.fn(), groupBy: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [OperationsService, { provide: PrismaService, useValue: prisma }],
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
      expect(result.bySide).toContainEqual({ side: 'SIDE_A', invited: 2, attending: 2 });
      expect(result.bySide).toContainEqual({ side: 'SIDE_B', invited: 3, attending: 1 });
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
      expect(sheet.requirements[0]).toEqual({ requirement: 'vegetarian', count: 2 });
      expect(sheet.requirements).toContainEqual({ requirement: 'nut-free', count: 1 });
      expect(sheet.notes).toEqual([{ guest: 'B Y', household: 'H2', note: 'severe' }]);
    });
  });

  describe('playlist', () => {
    it('deduplicates song requests and ranks by popularity', async () => {
      prisma.rsvp.findMany.mockResolvedValue([
        { songRequest: 'Sirun Yar' },
        { songRequest: '  Sirun Yar  ' },
        { songRequest: 'Another' },
        { songRequest: '   ' },
      ]);

      const result = await service.playlist('e1');

      expect(result.uniqueTracks).toBe(2);
      expect(result.tracks[0]).toEqual({ track: 'Sirun Yar', requests: 2 });
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
      expect(sheet.preferences[0]).toEqual({ drink: 'wine', guests: 3, share: 75 });
    });
  });

  it('rejects an unknown event', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.headcount('nope')).rejects.toThrow('No event nope');
  });
});
