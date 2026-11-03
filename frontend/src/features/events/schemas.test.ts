import { describe, expect, it } from 'vitest';

import { NEW_EVENT_VALUES } from './form-model';
import { eventFormSchema } from './schemas';

function problems(mode: 'create' | 'edit', values: Record<string, unknown>) {
  const result = eventFormSchema(mode).safeParse({ ...NEW_EVENT_VALUES, ...values });
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
}

const valid = {
  type: 'WEDDING',
  title: 'Anna & Davit',
  date: '2027-06-12',
  time: '15:00',
};

describe('the event form', () => {
  it('accepts a complete event, with the hosts left empty when creating', () => {
    expect(problems('create', valid)).toEqual({});
  });

  it('names every missing field at once', () => {
    expect(problems('create', {})).toEqual({
      type: 'choose',
      title: 'required',
      date: 'required',
      time: 'required',
    });
  });

  it('keeps the backend’s limits on the title and the hosts', () => {
    expect(problems('create', { ...valid, title: ' A ' })).toEqual({ title: 'titleShort' });
    expect(problems('create', { ...valid, title: 'A'.repeat(201) })).toEqual({ title: 'tooLong' });
    expect(problems('create', { ...valid, hostsLabel: 'A'.repeat(201) })).toEqual({
      hostsLabel: 'tooLong',
    });
  });

  it('requires the hosts when correcting, since the backend refuses an empty one', () => {
    expect(problems('edit', { ...valid, hostsLabel: '  ' })).toEqual({ hostsLabel: 'required' });
  });

  it('refuses a time the clocks skip, on the time field, alongside other problems', () => {
    expect(
      problems('create', {
        ...valid,
        title: '',
        date: '2027-03-28',
        time: '01:30',
        timezone: 'Europe/London',
      }),
    ).toEqual({ title: 'required', time: 'timeSkipped' });
  });

  it('refuses a date that does not exist', () => {
    expect(problems('create', { ...valid, date: '2027-02-30' })).toEqual({ date: 'dateInvalid' });
  });

  it('needs a language, and a default among the ticked ones', () => {
    // With none ticked, "a default among the ticked ones" would say nothing more.
    expect(problems('create', { ...valid, locales: [], defaultLocale: '' })).toEqual({
      locales: 'languages',
    });
    expect(problems('create', { ...valid, locales: ['hy'], defaultLocale: 'en' })).toEqual({
      defaultLocale: 'defaultLanguage',
    });
  });

  it('trims the title and the hosts', () => {
    const parsed = eventFormSchema('create').parse({
      ...NEW_EVENT_VALUES,
      ...valid,
      title: '  Anna & Davit ',
      hostsLabel: ' Anna ',
    });
    expect(parsed).toMatchObject({ title: 'Anna & Davit', hostsLabel: 'Anna' });
  });
});

describe('the end, the sides and the other languages', () => {
  it('takes no end, or both its date and time, after the start', () => {
    expect(problems('edit', { ...valid, hostsLabel: 'A' })).toEqual({});
    expect(problems('edit', { ...valid, hostsLabel: 'A', endDate: '2027-06-12' })).toEqual({
      endTime: 'endPair',
    });
    expect(
      problems('edit', { ...valid, hostsLabel: 'A', endDate: '2027-06-12', endTime: '15:00' }),
    ).toEqual({ endDate: 'endsBefore' });
    expect(
      problems('edit', { ...valid, hostsLabel: 'A', endDate: '2027-06-12', endTime: '23:00' }),
    ).toEqual({});
  });

  it('refuses an end the clocks skip in the event’s zone', () => {
    expect(
      problems('edit', {
        ...valid,
        hostsLabel: 'A',
        date: '2027-03-27',
        timezone: 'Europe/Berlin',
        endDate: '2027-03-28',
        endTime: '02:30',
      }),
    ).toEqual({ endTime: 'timeSkipped' });
  });

  it('takes a side up to 60 characters and each language’s words up to 200', () => {
    expect(
      problems('edit', {
        ...valid,
        hostsLabel: 'A',
        sideALabel: 'A'.repeat(60),
        translations: { ru: { title: 'A'.repeat(200), hostsLabel: 'A'.repeat(200) } },
      }),
    ).toEqual({});
    expect(
      problems('edit', {
        ...valid,
        hostsLabel: 'A',
        translations: { ru: { title: '', hostsLabel: 'A'.repeat(201) } },
      }),
    ).toEqual({ 'translations.ru.hostsLabel': 'tooLong' });
  });

  it('keeps the backend’s limits on the sides and on each language’s words', () => {
    expect(
      problems('edit', {
        ...valid,
        hostsLabel: 'A',
        sideALabel: 'A'.repeat(61),
        translations: { ru: { title: 'A'.repeat(201), hostsLabel: '' } },
      }),
    ).toEqual({ sideALabel: 'tooLong', 'translations.ru.title': 'tooLong' });
  });
});
