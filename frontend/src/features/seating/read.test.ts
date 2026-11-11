import { describe, expect, it } from 'vitest';

import { readArrangements, readJob, readTables } from './read';
import type { ArrangementWire, JobWire, TableWire } from './types';

describe('reading seating answers by naming their fields', () => {
  it('reads an arrangement, a venue’s and the plan without one', () => {
    const wire = [
      {
        id: 'a1',
        eventId: 'e1',
        venueId: 'hall',
        revision: 4,
        venue: { name: 'Hall', capacity: 120 },
        _count: { tables: 3 },
        extra: 'kept out',
      },
      { id: 'a0', eventId: 'e1', venueId: null, revision: 0, venue: null, _count: { tables: 0 } },
    ] as unknown as ArrangementWire[];
    expect(readArrangements(wire)).toEqual([
      {
        id: 'a1',
        venueId: 'hall',
        venueName: 'Hall',
        venueCapacity: 120,
        revision: 4,
        tableCount: 3,
      },
      { id: 'a0', venueId: null, venueName: null, venueCapacity: null, revision: 0, tableCount: 0 },
    ]);
  });

  it('reads a table, its guests and the seats a decline freed, nothing more', () => {
    const wire = [
      {
        id: 't1',
        name: 'Table 1',
        capacity: 10,
        zone: null,
        venueId: 'hall',
        venue: 'Hall',
        arrangementId: 'a1',
        posX: 1,
        posY: 2,
        shape: 'round',
        seated: 2,
        available: 8,
        guests: [
          {
            guestId: 'g1',
            name: 'Armen Petrosyan',
            position: 3,
            isReservation: true,
            token: 'never',
          },
          { guestId: 'g2', name: 'Lusine Petrosyan', position: null },
        ],
        released: [{ guestId: 'g3', name: 'Ani Sargsyan', releasedAt: '2027-05-01T10:00:00.000Z' }],
      },
    ] as unknown as TableWire[];
    const [table] = readTables(wire);
    expect(table).toEqual({
      id: 't1',
      arrangementId: 'a1',
      name: 'Table 1',
      capacity: 10,
      zone: null,
      posX: 1,
      posY: 2,
      shape: 'round',
      guests: [
        { guestId: 'g1', name: 'Armen Petrosyan', position: 3, isReservation: true },
        { guestId: 'g2', name: 'Lusine Petrosyan', position: null, isReservation: false },
      ],
      released: [{ guestId: 'g3', name: 'Ani Sargsyan', releasedAt: '2027-05-01T10:00:00.000Z' }],
    });
    expect(JSON.stringify(table)).not.toContain('never');
  });

  it.each([
    ['oval', 'oval'],
    [null, 'round'],
    [undefined, 'round'],
    ['hexagon', 'round'],
  ])('draws a shape of %s as %s', (shape, drawn) => {
    const wire = [
      { id: 't1', name: 'Table 1', capacity: 8, shape, guests: [], released: [] },
    ] as unknown as TableWire[];
    expect(readTables(wire)[0]?.shape).toBe(drawn);
  });

  it('reads a run with its result, the display code and sentence beside each reason', () => {
    const wire: JobWire = {
      id: 'j1',
      arrangementId: 'a1',
      status: 'COMPLETED',
      attempts: 1,
      failureReason: null,
      recovery: null,
      appliedRevision: 41,
      createdAt: '2027-06-01T10:00:00.000Z',
      completedAt: '2027-06-01T10:00:03.000Z',
      result: {
        seated: 84,
        households: 31,
        unseated: [
          {
            householdId: 'h9',
            size: 5,
            reason: 'Every table is full',
            explanation: {
              code: 'SEATING_TABLES_FULL',
              userMessage: 'Every table is full. Add capacity.',
            },
          },
          { householdId: 'h8', size: 2, reason: 'Old reason' },
        ],
      },
    };
    expect(readJob(wire)).toEqual({
      id: 'j1',
      arrangementId: 'a1',
      status: 'COMPLETED',
      attempts: 1,
      failureReason: null,
      recoveryMessage: null,
      appliedRevision: 41,
      createdAt: '2027-06-01T10:00:00.000Z',
      completedAt: '2027-06-01T10:00:03.000Z',
      result: {
        seated: 84,
        households: 31,
        unseated: [
          {
            householdId: 'h9',
            size: 5,
            reason: 'Every table is full',
            code: 'SEATING_TABLES_FULL',
            message: 'Every table is full. Add capacity.',
          },
          { householdId: 'h8', size: 2, reason: 'Old reason', code: null, message: null },
        ],
      },
    });
  });

  it('reads a failure’s sentence, a summary without a result, and an unknown status as ended', () => {
    const failed = readJob({
      id: 'j2',
      arrangementId: 'a1',
      status: 'FAILED',
      attempts: 3,
      failureReason: 'STATE_CHANGED',
      recovery: { userMessage: 'Refresh and run it again.' },
      appliedRevision: null,
      createdAt: '2027-06-01T10:00:00.000Z',
      completedAt: '2027-06-01T10:01:00.000Z',
    });
    expect(failed).toMatchObject({ recoveryMessage: 'Refresh and run it again.', result: null });
    expect(readJob({ ...wireOf(failed), status: 'CANCELLED' }).status).toBe('FAILED');
  });

  // The schema allows any value there; docs/API.md documents an object (FR-149).
  it.each([[[]], ['x'], [1], [true]])('reads a result of %j as none', (result) => {
    const job = readJob({ ...wireOf(readJob(SUMMARY)), result });
    expect(job.result).toBeNull();
  });
});

const SUMMARY: JobWire = {
  id: 'j3',
  arrangementId: 'a1',
  status: 'COMPLETED',
  attempts: 1,
  failureReason: null,
  appliedRevision: 4,
  createdAt: '2027-06-01T10:00:00.000Z',
  completedAt: '2027-06-01T10:00:02.000Z',
};

function wireOf(job: ReturnType<typeof readJob>): JobWire {
  return { ...job, recovery: null, result: null };
}
