import { changedFields, detailsProblem } from './event-details';

describe('detailsProblem', () => {
  const valid = {
    startsAt: new Date('2027-06-12T15:00:00Z'),
    endsAt: new Date('2027-06-12T23:00:00Z'),
    timezone: 'Asia/Yerevan',
    locales: ['hy', 'en'],
    defaultLocale: 'hy',
  };

  it('accepts a consistent set of details', () => {
    expect(detailsProblem(valid)).toBeNull();
    expect(detailsProblem({ ...valid, endsAt: null })).toBeNull();
  });

  it.each([
    ['an end before the start', { endsAt: new Date('2027-06-12T14:00:00Z') }, /^endsAt: /],
    ['an end equal to the start', { endsAt: new Date('2027-06-12T15:00:00Z') }, /^endsAt: /],
    ['a made-up time zone', { timezone: 'Armenia/Yerevan' }, /^timezone: /],
    ['a language that is not a code', { locales: ['hy', 'Armenian'] }, /^locales: /],
    ['the same language twice', { locales: ['hy', 'hy'] }, /^locales: /],
    ['a default language the event does not publish', { defaultLocale: 'ru' }, /^defaultLocale: /],
  ])('refuses %s, naming the field', (_label, change, message) => {
    expect(detailsProblem({ ...valid, ...change })).toMatch(message);
  });
});

describe('changedFields', () => {
  it('compares dates by moment and lists by contents', () => {
    const before = { startsAt: new Date('2027-01-01T00:00:00Z'), locales: ['hy'], title: 'A' };
    const after = { startsAt: new Date('2027-01-01T00:00:00Z'), locales: ['hy', 'en'], title: 'A' };
    expect(changedFields(before, after, ['startsAt', 'locales', 'title'])).toEqual(['locales']);
  });
});
