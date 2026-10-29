import { describe, expect, it } from 'vitest';

import { formValuesOf, languageOptions, NEW_EVENT_VALUES, toggleLanguage } from './form-model';
import { createPayload, updatePayload } from './payload';
import type { EventFormValues } from './schemas';
import type { EventDetail } from './types';

const event: EventDetail = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['en', 'hy'],
  defaultLocale: 'hy',
  sideALabel: null,
  sideBLabel: null,
  invitation: { slug: 'anna-davit-3f8a1c20', status: 'DRAFT' },
};

const filled: EventFormValues = {
  type: 'WEDDING',
  title: 'The wedding of Anna and Davit',
  hostsLabel: '',
  date: '2027-06-12',
  time: '15:00',
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'hy',
};

describe('a new event', () => {
  it('starts in Yerevan, in Armenian, with no type chosen', () => {
    expect(NEW_EVENT_VALUES).toMatchObject({
      type: '',
      timezone: 'Asia/Yerevan',
      locales: ['hy'],
      defaultLocale: 'hy',
    });
  });

  it('sends the time typed in the event’s zone as UTC', () => {
    expect(createPayload(filled)).toEqual({
      type: 'WEDDING',
      title: 'The wedding of Anna and Davit',
      startsAt: '2027-06-12T11:00:00.000Z',
      timezone: 'Asia/Yerevan',
      locales: ['hy', 'en'],
      defaultLocale: 'hy',
    });
  });

  it('leaves out an empty hosts label, so the title stands in (FR-25)', () => {
    expect(createPayload(filled)).not.toHaveProperty('hostsLabel');
    expect(createPayload({ ...filled, hostsLabel: 'Anna & Davit' })).toHaveProperty(
      'hostsLabel',
      'Anna & Davit',
    );
  });
});

describe('formValuesOf', () => {
  it('shows the start in the event’s own zone', () => {
    expect(formValuesOf(event)).toMatchObject({ date: '2027-06-12', time: '15:00' });
    expect(formValuesOf({ ...event, timezone: 'America/Los_Angeles' })).toMatchObject({
      date: '2027-06-12',
      time: '04:00',
    });
  });

  it('keeps the event’s languages and default', () => {
    expect(formValuesOf(event)).toMatchObject({ locales: ['en', 'hy'], defaultLocale: 'hy' });
  });
});

describe('updatePayload', () => {
  const initial = formValuesOf(event);

  it('sends nothing when nothing changed', () => {
    expect(updatePayload(initial, { ...initial })).toEqual({});
  });

  it('sends only the field that changed', () => {
    expect(updatePayload(initial, { ...initial, title: 'Anna and Davit' })).toEqual({
      title: 'Anna and Davit',
    });
    expect(updatePayload(initial, { ...initial, hostsLabel: 'Anna and Davit' })).toEqual({
      hostsLabel: 'Anna and Davit',
    });
    expect(updatePayload(initial, { ...initial, type: 'ENGAGEMENT' })).toEqual({
      type: 'ENGAGEMENT',
    });
    expect(updatePayload(initial, { ...initial, defaultLocale: 'en' })).toEqual({
      defaultLocale: 'en',
    });
  });

  it('sends the new start when the date or the time changed', () => {
    expect(updatePayload(initial, { ...initial, date: '2027-07-03' })).toEqual({
      startsAt: '2027-07-03T11:00:00.000Z',
    });
    expect(updatePayload(initial, { ...initial, time: '16:30' })).toEqual({
      startsAt: '2027-06-12T12:30:00.000Z',
    });
  });

  it('keeps the typed time when only the zone changed, so the instant moves with it', () => {
    expect(updatePayload(initial, { ...initial, timezone: 'Europe/Moscow' })).toEqual({
      startsAt: '2027-06-12T12:00:00.000Z',
      timezone: 'Europe/Moscow',
    });
  });

  it('sends no languages when the same ones are ticked in another order', () => {
    expect(updatePayload(initial, { ...initial, locales: ['hy', 'en'] })).toEqual({});
  });

  it('keeps the event’s order of languages and adds new ones after it', () => {
    expect(updatePayload(initial, { ...initial, locales: ['hy', 'ru', 'en'] })).toEqual({
      locales: ['en', 'hy', 'ru'],
    });
    expect(updatePayload(initial, { ...initial, locales: ['hy'] })).toEqual({ locales: ['hy'] });
  });
});

describe('languages', () => {
  it('offers Armenian, Russian, English and French, and keeps any other the event already has', () => {
    expect(languageOptions()).toEqual(['hy', 'ru', 'en', 'fr']);
    expect(languageOptions(['en', 'de'])).toEqual(['hy', 'ru', 'en', 'fr', 'de']);
  });

  it('keeps the ticked languages in the order they are offered', () => {
    expect(
      toggleLanguage({ locales: ['en'], defaultLocale: 'en' }, 'hy', true, languageOptions()),
    ).toEqual({ locales: ['hy', 'en'], defaultLocale: 'en' });
  });

  it('moves the default to the first ticked language when its own is unticked', () => {
    expect(
      toggleLanguage(
        { locales: ['hy', 'ru', 'en'], defaultLocale: 'hy' },
        'hy',
        false,
        languageOptions(),
      ),
    ).toEqual({ locales: ['ru', 'en'], defaultLocale: 'ru' });
  });

  it('gives the first language ticked the default when none was left', () => {
    const none = toggleLanguage({ locales: ['hy'], defaultLocale: 'hy' }, 'hy', false, [
      'hy',
      'ru',
      'en',
    ]);
    expect(none).toEqual({ locales: [], defaultLocale: '' });
    expect(toggleLanguage(none, 'ru', true, ['hy', 'ru', 'en'])).toEqual({
      locales: ['ru'],
      defaultLocale: 'ru',
    });
  });
});
