import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { briefFailureOf, readBrief } from './read';
import { briefWire } from './test-data';
import type { BriefWire, HeadcountWire } from './types';

/** The answer with only the sections a test names granted, as the backend sends them. */
function wire(overrides: Partial<BriefWire> = {}): BriefWire {
  return briefWire({
    granted: [
      { section: 'headcount', purpose: 'Confirmed headcount by side' },
      { section: 'catering', purpose: 'Covers and dietary requirements' },
    ],
    ...overrides,
  });
}

describe('reading a brief', () => {
  it('keeps the sections in the order granted, each with what it holds', () => {
    const brief = readBrief(wire());
    expect(brief.sections.map((each) => each.section)).toEqual(['headcount', 'catering']);
    expect(brief.sections[1]).toEqual({
      section: 'catering',
      data: {
        covers: 90,
        requirements: [{ requirement: 'Vegetarian', count: 6 }],
        notes: [{ guest: 'Ani K', household: 'Karapetyan', note: 'No nuts' }],
      },
    });
  });

  it('reads only what was granted, never a section the answer happens to carry', () => {
    const brief = readBrief(
      wire({
        granted: [{ section: 'timeline', purpose: 'Running order and access times' }],
        timeline: [{ occursAt: '2027-06-12T13:00:00.000Z', venue: null }],
      }),
    );
    expect(brief.sections).toEqual([
      {
        section: 'timeline',
        data: [{ label: null, occursAt: '2027-06-12T13:00:00.000Z', venue: null }],
      },
    ]);
  });

  it('shows a granted section it has no words for by its purpose alone', () => {
    const answer = { ...wire({ granted: [{ section: 'florals', purpose: 'Flowers per table' }] }) };
    const brief = readBrief({ ...answer, florals: { secret: 'kept back' } } as BriefWire);
    expect(brief.sections).toEqual([
      { section: 'unknown', key: 'florals', purpose: 'Flowers per table' },
    ]);
    expect(JSON.stringify(brief)).not.toContain('kept back');
  });

  it('shows a granted section the answer left out by its purpose, never as an empty one', () => {
    const { households: _leftOut, ...answer } = wire({
      granted: [{ section: 'households', purpose: 'Guests grouped by household' }],
    });
    const brief = readBrief(answer);
    expect(brief.sections).toEqual([
      { section: 'unknown', key: 'households', purpose: 'Guests grouped by household' },
    ]);
  });

  it('keeps each contact’s name, email and phone, and nothing else that came with them', () => {
    const contacts = [
      { name: 'Ani K', email: 'ani@example.am', phone: null, guestId: 'g1', token: 'x' },
    ];
    const brief = readBrief(
      wire({
        granted: [{ section: 'contacts', purpose: 'Guest emails and phone numbers' }],
        contacts,
      }),
    );
    expect(brief.sections).toEqual([
      { section: 'contacts', data: [{ name: 'Ani K', email: 'ani@example.am', phone: null }] },
    ]);
  });

  it('keeps each household with its guests’ names, and nothing else', () => {
    const households = [{ household: 'Karapetyan', guests: ['Ani K'], id: 'h1' }];
    const brief = readBrief(
      wire({
        granted: [{ section: 'households', purpose: 'Guests grouped by household' }],
        households,
      }),
    );
    expect(brief.sections).toEqual([
      { section: 'households', data: [{ household: 'Karapetyan', guests: ['Ani K'] }] },
    ]);
  });

  it('says how many seats were freed, not by whom, and drops the guests’ ids', () => {
    const brief = readBrief(
      wire({
        granted: [{ section: 'seating', purpose: 'Tables' }],
        seating: [
          {
            name: 'Table 1',
            capacity: 10,
            zone: null,
            venue: 'Garden hall',
            seated: 8,
            guests: [{ name: 'Ani K', guestId: 'g1' } as { name: string }],
            released: [{ guestId: 'g2', name: 'Who declined', releasedAt: '2027-05-01T00:00:00Z' }],
          },
        ],
      }),
    );
    expect(brief.sections).toEqual([
      {
        section: 'seating',
        data: [
          {
            name: 'Table 1',
            capacity: 10,
            zone: null,
            venue: 'Garden hall',
            seated: 8,
            guests: ['Ani K'],
            freed: 1,
          },
        ],
      },
    ]);
    expect(JSON.stringify(brief)).not.toMatch(/Who declined|g1|g2/);
  });

  it('drops the headcount’s day-by-day trend and any map link that is not http or https', () => {
    const brief = readBrief(
      wire({
        headcount: { ...wire().headcount, trend: [{ date: '2027-05-01' }] } as HeadcountWire,
        event: {
          ...wire().event,
          venues: [
            {
              role: 'CEREMONY',
              name: 'Church',
              address: 'x',
              arriveAt: null,
              mapUrl: 'javascript:alert(1)',
            },
          ],
        },
      }),
    );
    expect(JSON.stringify(brief)).not.toContain('trend');
    expect(brief.event.venues[0]?.mapUrl).toBeNull();
  });
});

describe('why a brief could not be opened', () => {
  it.each([
    [404, 'gone'],
    [403, 'ended'],
    [429, 'rateLimited'],
    [500, 'failed'],
  ] as const)('reads a %i as %s', (status, kind) => {
    expect(briefFailureOf(new ApiError({ status, messages: ['x'], requestId: 'r' })).kind).toBe(
      kind,
    );
  });

  it('keeps a network failure’s reference, and reads an answer it can’t read as a failure', () => {
    expect(briefFailureOf(networkError('r-0'))).toEqual({ kind: 'failed', requestId: 'r-0' });
    expect(briefFailureOf(new TypeError('granted is undefined'))).toEqual({ kind: 'failed' });
  });
});
