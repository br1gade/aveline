import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError, networkError } from '@/api/errors';

import { entryFormValues, entryLanguages, newEntryValues } from './form-model';
import { sortOrderFor, venuesHiddenBy, type EntryChange } from './order';
import { entryUpdatePayload, newEntryPayload } from './payload';
import { labelIn, readEntries } from './read';
import { refusalOf, SENTENCES } from './refusals';
import { entryFormSchema } from './schemas';
import type { OrderVenue, TimelineEntry } from './types';

const ZONE = 'Asia/Yerevan';

function entry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: 't1',
    label: { hy: 'Պսակադրություն', en: 'Ceremony' },
    // 15:00 in Yerevan.
    occursAt: '2027-06-12T11:00:00.000Z',
    sortOrder: 0,
    isInternal: false,
    venueId: 'church',
    venueName: 'Saint Gayane',
    ...overrides,
  };
}

describe('readEntries', () => {
  it('keeps the API’s order and only the words a label really has', () => {
    const read = readEntries([
      {
        id: 'b',
        label: { hy: 'Տորթ', en: ' ', xx: 4 },
        occursAt: '2027-06-12T18:00:00.000Z',
        sortOrder: 0,
        isInternal: true,
        venue: null,
      },
      {
        id: 'a',
        label: 'nonsense',
        occursAt: '2027-06-12T11:00:00.000Z',
        sortOrder: 0,
        isInternal: false,
        venue: { id: 'church', name: 'Saint Gayane' },
      },
    ]);
    expect(read.map((one) => one.id)).toEqual(['b', 'a']);
    expect(read[0]?.label).toEqual({ hy: 'Տորթ' });
    expect(read[1]).toMatchObject({ label: {}, venueId: 'church', venueName: 'Saint Gayane' });
  });
});

describe('labelIn', () => {
  it('uses the default language, else the first one there is, and says which', () => {
    expect(labelIn({ hy: 'Պսակ', en: 'Ceremony' }, 'en')).toEqual({
      text: 'Ceremony',
      language: 'en',
    });
    expect(labelIn({ ru: 'Торт' }, 'hy')).toEqual({ text: 'Торт', language: 'ru' });
    expect(labelIn({}, 'hy')).toBeNull();
  });
});

describe('sortOrderFor', () => {
  const entries = [
    entry({ id: 'a', sortOrder: 0 }),
    entry({ id: 'b', sortOrder: 3, occursAt: '2027-06-12T11:00:30.000Z' }),
    entry({ id: 'c', sortOrder: 9, occursAt: '2027-06-12T11:01:00.000Z' }),
  ];

  it('puts a new entry last among those at the same minute', () => {
    expect(sortOrderFor(entries, '2027-06-12T11:00:00.000Z')).toBe(4);
  });

  it('starts at 0 at a minute nobody has', () => {
    expect(sortOrderFor(entries, '2027-06-12T12:00:00.000Z')).toBe(0);
  });

  it('stays within the backend’s 1,000', () => {
    expect(sortOrderFor([entry({ sortOrder: 1000 })], '2027-06-12T11:00:00.000Z')).toBe(1000);
  });
});

describe('venuesHiddenBy', () => {
  const venues: OrderVenue[] = [
    { id: 'church', role: 'CEREMONY', name: 'Saint Gayane' },
    { id: 'hall', role: 'RECEPTION', name: 'Hall' },
    { id: 'room', role: 'PREPARATION', name: 'Room' },
  ];
  const entries = [
    entry({ id: 'a', venueId: 'church' }),
    entry({ id: 'b', venueId: 'hall' }),
    entry({ id: 'c', venueId: 'hall', isInternal: true }),
  ];
  const hidden = (change: EntryChange) => venuesHiddenBy(venues, entries, change).map((v) => v.id);

  it('names a venue whose last guest entry is marked for the team', () => {
    expect(hidden({ kind: 'save', id: 'b', venueId: 'hall', isInternal: true })).toEqual(['hall']);
  });

  it('names a venue whose last guest entry is removed while a team one stays', () => {
    expect(hidden({ kind: 'remove', id: 'b' })).toEqual(['hall']);
  });

  it('names a venue left by its last guest entry for another', () => {
    expect(hidden({ kind: 'save', id: 'b', venueId: 'church', isInternal: false })).toEqual([
      'hall',
    ]);
  });

  it('names a venue with no entries that gets a team-only one', () => {
    const bare = venuesHiddenBy(venues, [], { kind: 'save', venueId: 'church', isInternal: true });
    expect(bare.map((v) => v.id)).toEqual(['church']);
  });

  it('names nothing while a guest entry stays, and never a venue for getting ready', () => {
    expect(hidden({ kind: 'save', id: 'a', venueId: 'church', isInternal: false })).toEqual([]);
    expect(hidden({ kind: 'save', venueId: 'room', isInternal: true })).toEqual([]);
    expect(hidden({ kind: 'remove', id: 'c' })).toEqual([]);
  });
});

describe('the entry form', () => {
  const schema = entryFormSchema(ZONE);
  const valid = { labels: { hy: '', en: 'Cake' }, date: '2027-06-12', time: '21:00' };

  it('needs a name in one language at least, not only spaces', () => {
    const result = schema.safeParse({
      ...valid,
      labels: { hy: ' ', en: '' },
      venueId: '',
      isInternal: false,
    });
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['labels'], 'labelRequired'],
    ]);
  });

  it('needs a date and a time', () => {
    const result = schema.safeParse({
      ...valid,
      date: '',
      time: '',
      venueId: '',
      isInternal: false,
    });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['required', 'required']);
  });

  it('refuses a date that doesn’t exist', () => {
    const result = schema.safeParse({
      ...valid,
      date: '2027-02-30',
      venueId: '',
      isInternal: false,
    });
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['date'], 'dateInvalid'],
    ]);
  });

  it('refuses a time the clocks skip in the event’s zone', () => {
    const berlin = entryFormSchema('Europe/Berlin');
    const result = berlin.safeParse({
      ...valid,
      date: '2027-03-28',
      time: '02:30',
      venueId: '',
      isInternal: false,
    });
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['time'], 'timeSkipped'],
    ]);
  });
});

describe('the form model', () => {
  it('offers the event’s languages, then any other the entry has', () => {
    expect(entryLanguages(['hy', 'en'], entry({ label: { de: 'Trauung', en: 'x' } }))).toEqual([
      'hy',
      'en',
      'de',
    ]);
  });

  it('starts a new entry on the event’s day in its zone', () => {
    // 22:30 UTC on the 11th is already the 12th in Yerevan.
    expect(newEntryValues(['hy'], '2027-06-11T22:30:00.000Z', ZONE)).toEqual({
      labels: { hy: '' },
      date: '2027-06-12',
      time: '',
      venueId: '',
      isInternal: false,
    });
  });

  it('shows an entry’s time in the event’s zone', () => {
    expect(entryFormValues(entry(), ['hy', 'en', 'ru'], ZONE)).toEqual({
      labels: { hy: 'Պսակադրություն', en: 'Ceremony', ru: '' },
      date: '2027-06-12',
      time: '15:00',
      venueId: 'church',
      isInternal: false,
    });
  });
});

describe('newEntryPayload', () => {
  it('sends the time as UTC, non-blank names, and goes last at its minute', () => {
    const values = {
      labels: { hy: '', en: 'Cake' },
      date: '2027-06-12',
      time: '15:00',
      venueId: '',
      isInternal: true,
    };
    expect(newEntryPayload(values, ZONE, [entry({ sortOrder: 2 })])).toEqual({
      label: { en: 'Cake' },
      occursAt: '2027-06-12T11:00:00.000Z',
      isInternal: true,
      sortOrder: 3,
    });
  });

  it('names the venue chosen', () => {
    const values = {
      labels: { en: 'Cake' },
      date: '2027-06-12',
      time: '20:00',
      venueId: 'hall',
      isInternal: false,
    };
    expect(newEntryPayload(values, ZONE, [])).toMatchObject({ venueId: 'hall', sortOrder: 0 });
  });
});

describe('entryUpdatePayload', () => {
  const initial = entryFormValues(entry(), ['hy', 'en'], ZONE);
  const context = { timeZone: ZONE, entries: [entry(), entry({ id: 'x', sortOrder: 5 })] };
  const update = (changes: Partial<typeof initial>) =>
    entryUpdatePayload(entry(), initial, { ...initial, ...changes }, context);

  it('sends nothing when nothing changed', () => {
    expect(update({})).toEqual({});
  });

  it('sends only the language changed, and null for one emptied', () => {
    expect(update({ labels: { hy: '', en: 'The ceremony' } })).toEqual({
      label: { hy: null, en: 'The ceremony' },
    });
  });

  it('sends a new time as UTC, at a minute nobody has', () => {
    expect(update({ time: '15:00', date: '2027-06-12' })).toEqual({});
    expect(update({ time: '16:30' })).toEqual({
      occursAt: '2027-06-12T12:30:00.000Z',
      sortOrder: 0,
    });
  });

  it('keeps its place when an edit lands on the entry’s own minute', () => {
    const moved = entryUpdatePayload(
      entry(),
      { ...initial, time: '15:01' },
      { ...initial, time: '15:00' },
      context,
    );
    expect(moved).toEqual({ occursAt: '2027-06-12T11:00:00.000Z' });
  });

  it('goes last when moved to a minute with others', () => {
    const busy = [entry(), entry({ id: 'y', occursAt: '2027-06-12T12:30:00.000Z', sortOrder: 2 })];
    expect(
      entryUpdatePayload(
        entry(),
        initial,
        { ...initial, time: '16:30' },
        { timeZone: ZONE, entries: busy },
      ),
    ).toEqual({ occursAt: '2027-06-12T12:30:00.000Z', sortOrder: 3 });
  });

  it('detaches it from its venue with null, and sends the team mark when it changed', () => {
    expect(update({ venueId: '', isInternal: true })).toEqual({ venueId: null, isInternal: true });
  });
});

describe('refusalOf', () => {
  const refused = (status: number, message = 'refused') =>
    new ApiError({ status, messages: [message], requestId: `r-${status}` });

  it.each([
    [refused(403), { kind: 'forbidden' }],
    [refused(429), { kind: 'rateLimited' }],
    [refused(500), { kind: 'noAnswer', requestId: 'r-500' }],
    [refused(499, 'New'), { kind: 'other', sentence: 'New' }],
    [networkError(), { kind: 'noAnswer' }],
    [refused(404), { kind: 'gone', isStale: true }],
    [
      refused(400, 'Something new'),
      { kind: 'other', sentence: 'Something new', requestId: 'r-400' },
    ],
  ])('words %#', (error, expected) => {
    expect(refusalOf(error)).toMatchObject(expected);
  });

  it.each(SENTENCES.map(([words, kind, isStale]) => [words, kind, isStale]))(
    'recognises “%s”',
    (words, kind, isStale) => {
      expect(refusalOf(refused(409, words))).toEqual({ kind, isStale });
    },
  );

  it('throws on what isn’t the API’s', () => {
    expect(() => refusalOf(new Error('bug'))).toThrow('bug');
  });
});

describe('the backend’s sentences', () => {
  it('are still in its sources', () => {
    const source = join(process.cwd(), '..', 'backend', 'src');
    const sources = [
      'modules/design/timeline.service.ts',
      'modules/rsvp/attendance/venue-attendance.ts',
    ]
      .map((path) => readFileSync(join(source, path), 'utf8'))
      .join('');
    for (const [words] of SENTENCES) expect(sources).toContain(words);
  });
});
