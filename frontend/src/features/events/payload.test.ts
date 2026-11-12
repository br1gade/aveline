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
  endDate: '',
  endTime: '',
  sideALabel: '',
  sideBLabel: '',
  translations: {},
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

  it('sends an end typed in the event’s zone as UTC, and the sides typed', () => {
    expect(
      createPayload({
        ...filled,
        endDate: '2027-06-12',
        endTime: '23:30',
        sideALabel: 'Anna’s family',
        sideBLabel: 'Davit’s family',
      }),
    ).toMatchObject({
      endsAt: '2027-06-12T19:30:00.000Z',
      sideALabel: 'Anna’s family',
      sideBLabel: 'Davit’s family',
    });
  });

  it('leaves out a blank end and blank sides', () => {
    const body = createPayload(filled);
    expect(body).not.toHaveProperty('endsAt');
    expect(body).not.toHaveProperty('sideALabel');
    expect(body).not.toHaveProperty('sideBLabel');
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
    expect(updatePayload(initial, { ...initial }, event.translations)).toEqual({});
  });

  it('sends only the field that changed', () => {
    expect(
      updatePayload(initial, { ...initial, title: 'Anna and Davit' }, event.translations),
    ).toEqual({
      title: 'Anna and Davit',
    });
    expect(
      updatePayload(initial, { ...initial, hostsLabel: 'Anna and Davit' }, event.translations),
    ).toEqual({
      hostsLabel: 'Anna and Davit',
    });
    expect(updatePayload(initial, { ...initial, type: 'ENGAGEMENT' }, event.translations)).toEqual({
      type: 'ENGAGEMENT',
    });
    expect(updatePayload(initial, { ...initial, defaultLocale: 'en' }, event.translations)).toEqual(
      {
        defaultLocale: 'en',
      },
    );
  });

  it('sends the new start when the date or the time changed', () => {
    expect(updatePayload(initial, { ...initial, date: '2027-07-03' }, event.translations)).toEqual({
      startsAt: '2027-07-03T11:00:00.000Z',
    });
    expect(updatePayload(initial, { ...initial, time: '16:30' }, event.translations)).toEqual({
      startsAt: '2027-06-12T12:30:00.000Z',
    });
  });

  it('keeps the typed time when only the zone changed, so the instant moves with it', () => {
    expect(
      updatePayload(initial, { ...initial, timezone: 'Europe/Moscow' }, event.translations),
    ).toEqual({
      startsAt: '2027-06-12T12:00:00.000Z',
      timezone: 'Europe/Moscow',
    });
  });

  it('sends no languages when the same ones are ticked in another order', () => {
    expect(
      updatePayload(initial, { ...initial, locales: ['hy', 'en'] }, event.translations),
    ).toEqual({});
  });

  it('keeps the event’s order of languages and adds new ones after it', () => {
    expect(
      updatePayload(initial, { ...initial, locales: ['hy', 'ru', 'en'] }, event.translations),
    ).toEqual({
      locales: ['en', 'hy', 'ru'],
    });
    expect(updatePayload(initial, { ...initial, locales: ['hy'] }, event.translations)).toEqual({
      locales: ['hy'],
    });
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

describe('the end, the sides and the other languages (design PD-109, PD-110)', () => {
  const translated: EventDetail = {
    ...event,
    locales: ['hy', 'en', 'ru'],
    endsAt: '2027-06-12T20:00:00.000Z',
    sideALabel: 'Anna’s family',
    translations: {
      en: { title: 'The wedding', hostsLabel: 'Anna & Davit', sideALabel: 'Bride’s side' },
      fr: { title: 'Mariage' },
    },
  };
  const initial = formValuesOf(translated);
  const edit = (changes: Partial<EventFormValues>) =>
    updatePayload(initial, { ...initial, ...changes }, translated.translations);

  it('shows the end in the event’s zone, the sides, and every language’s stored words', () => {
    expect(initial).toMatchObject({
      endDate: '2027-06-13',
      endTime: '00:00',
      sideALabel: 'Anna’s family',
      sideBLabel: '',
    });
    expect(initial.translations).toMatchObject({
      en: {
        title: 'The wedding',
        hostsLabel: 'Anna & Davit',
        sideALabel: 'Bride’s side',
        sideBLabel: '',
      },
      ru: { title: '', hostsLabel: '', sideALabel: '', sideBLabel: '' },
      fr: { title: 'Mariage', hostsLabel: '', sideALabel: '', sideBLabel: '' },
    });
  });

  it('sends nothing when nothing changed', () => {
    expect(edit({})).toEqual({});
  });

  it('sends a new end as UTC, and null for one emptied', () => {
    expect(edit({ endTime: '01:30' })).toEqual({ endsAt: '2027-06-12T21:30:00.000Z' });
    expect(edit({ endDate: '', endTime: '' })).toEqual({ endsAt: null });
  });

  it('sends no end for a new zone when there is none', () => {
    const open = formValuesOf({ ...translated, endsAt: null });
    expect(
      updatePayload(open, { ...open, timezone: 'Europe/Paris' }, translated.translations),
    ).not.toHaveProperty('endsAt');
  });

  it('moves the end with a new zone, as it moves the start', () => {
    expect(edit({ timezone: 'Europe/Paris' })).toMatchObject({
      timezone: 'Europe/Paris',
      endsAt: '2027-06-12T22:00:00.000Z',
    });
  });

  it('sends a side changed, and null for one emptied', () => {
    expect(edit({ sideALabel: '', sideBLabel: 'Davit’s family' })).toEqual({
      sideALabel: null,
      sideBLabel: 'Davit’s family',
    });
  });

  it('sends a changed language whole, and null for one emptied', () => {
    expect(
      edit({
        translations: {
          ...initial.translations,
          en: {
            title: 'Our wedding',
            hostsLabel: 'Anna & Davit',
            sideALabel: 'Bride’s side',
            sideBLabel: '',
          },
          ru: { title: 'Свадьба', hostsLabel: '', sideALabel: '', sideBLabel: '' },
        },
      }),
    ).toEqual({
      translations: {
        en: { title: 'Our wedding', hostsLabel: 'Anna & Davit', sideALabel: 'Bride’s side' },
        ru: { title: 'Свадьба' },
      },
    });
    expect(
      edit({
        translations: {
          ...initial.translations,
          en: { title: '', hostsLabel: '', sideALabel: '', sideBLabel: '' },
        },
      }),
    ).toEqual({ translations: { en: null } });
  });

  it('sends a language’s side names with its other words (FR-96)', () => {
    expect(
      edit({
        translations: {
          ...initial.translations,
          ru: {
            title: '',
            hostsLabel: '',
            sideALabel: 'Сторона невесты',
            sideBLabel: 'Сторона жениха',
          },
        },
      }),
    ).toEqual({
      translations: { ru: { sideALabel: 'Сторона невесты', sideBLabel: 'Сторона жениха' } },
    });
    expect(
      edit({
        translations: {
          ...initial.translations,
          en: { title: 'The wedding', hostsLabel: 'Anna & Davit', sideALabel: '', sideBLabel: '' },
        },
      }),
    ).toEqual({ translations: { en: { title: 'The wedding', hostsLabel: 'Anna & Davit' } } });
  });

  it('leaves alone a language no longer ticked, whose words stay stored', () => {
    expect(
      edit({
        locales: ['hy', 'ru'],
        translations: {
          ...initial.translations,
          en: { title: '', hostsLabel: '', sideALabel: '', sideBLabel: '' },
        },
      }),
    ).toEqual({ locales: ['hy', 'ru'] });
  });
});
