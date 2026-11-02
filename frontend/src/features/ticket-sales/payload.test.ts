import { describe, expect, it } from 'vitest';

import { announcementFormValues, languagesWithStored, ticketTypeFormValues } from './form-model';
import { announcementBody, createTicketTypeBody, updateTicketTypeBody } from './payload';
import { listing, ticketType } from './test-data';

const CONTEXT = { languages: ['hy', 'en'], timeZone: 'Asia/Yerevan', currency: 'AMD' };

describe('a new ticket type', () => {
  it('sends its names in each language given, its price in minor units and its limits', () => {
    const values = {
      ...ticketTypeFormValues(null, CONTEXT),
      names: { hy: ' Ընդհանուր ', en: '' },
      price: '15000',
      quantityTotal: '200',
      salesEndDate: '2027-10-02',
      salesEndTime: '00:00',
    };
    expect(createTicketTypeBody(values, CONTEXT)).toEqual({
      name: { hy: 'Ընդհանուր' },
      priceMinor: '15000',
      quantityTotal: 200,
      minPerOrder: 1,
      maxPerOrder: 10,
      salesEndAt: '2027-10-01T20:00:00.000Z',
    });
  });

  it('prices a currency with cents in its minor units, and a free ticket as "0"', () => {
    const base = {
      ...ticketTypeFormValues(null, CONTEXT),
      names: { en: 'VIP', hy: '' },
      quantityTotal: '5',
    };
    expect(
      createTicketTypeBody({ ...base, price: '10.50' }, { ...CONTEXT, currency: 'USD' }).priceMinor,
    ).toBe('1050');
    expect(createTicketTypeBody({ ...base, price: '0' }, CONTEXT).priceMinor).toBe('0');
  });
});

describe('correcting a ticket type', () => {
  const type = ticketType();
  const baseline = ticketTypeFormValues(type, CONTEXT);

  it('reads the stored type back into the form, in the event’s zone', () => {
    expect(baseline).toMatchObject({
      names: { hy: 'Ընդհանուր', en: 'General' },
      price: '15000',
      quantityTotal: '200',
      salesEndDate: '2027-10-02',
      salesEndTime: '00:00',
      salesStartDate: '',
    });
  });

  it('sends nothing when nothing changed', () => {
    expect(updateTicketTypeBody(baseline, baseline, CONTEXT)).toEqual({});
  });

  it('sends only what changed, every language of a name that changed', () => {
    const changed = {
      ...baseline,
      names: { ...baseline.names, en: 'Standing' },
      price: '12000',
      maxPerOrder: '6',
    };
    expect(updateTicketTypeBody(baseline, changed, CONTEXT)).toEqual({
      name: { hy: 'Ընդհանուր', en: 'Standing' },
      priceMinor: '12000',
      maxPerOrder: 6,
    });
  });

  it('sends a description emptied in every language as an empty one', () => {
    const before = ticketTypeFormValues(ticketType({ description: { en: 'Standing' } }), CONTEXT);
    expect(
      updateTicketTypeBody(before, { ...before, descriptions: { hy: '', en: '' } }, CONTEXT),
    ).toEqual({
      description: {},
    });
  });

  it('sends a moved sales window as the instant it means in the event’s zone', () => {
    const moved = { ...baseline, salesStartDate: '2027-09-01', salesStartTime: '10:00' };
    expect(updateTicketTypeBody(baseline, moved, CONTEXT)).toEqual({
      salesStartAt: '2027-09-01T06:00:00.000Z',
    });
  });
});

describe('a language the event no longer publishes', () => {
  it('stays on the form after the event’s own, so a save does not lose its words', () => {
    expect(languagesWithStored(['hy', 'en'], { en: 'A', ru: 'Б' }, { fr: ' ', de: 'C' })).toEqual([
      'hy',
      'en',
      'ru',
      'de',
    ]);
  });

  it('is kept when another language of the name changes', () => {
    const type = ticketType({ name: { en: 'General', ru: 'Входной' } });
    const context = { ...CONTEXT, languages: languagesWithStored(CONTEXT.languages, type.name) };
    const baseline = ticketTypeFormValues(type, context);
    const changed = { ...baseline, names: { ...baseline.names, en: 'Standing' } };
    expect(updateTicketTypeBody(baseline, changed, context)).toEqual({
      name: { en: 'Standing', ru: 'Входной' },
    });
  });

  it('is kept when another language of the announcement changes', () => {
    const stored = listing({ headline: { en: 'Jazz', ru: 'Джаз' } });
    const languages = languagesWithStored(['en'], stored.headline);
    const baseline = announcementFormValues(stored, languages);
    const values = {
      ...baseline,
      copy: { ...baseline.copy, en: { ...baseline.copy.en!, headline: 'Autumn Jazz' } },
    };
    expect(announcementBody(stored, values, languages)).toEqual({
      headline: { en: 'Autumn Jazz', ru: 'Джаз' },
    });
  });
});

describe('the announcement', () => {
  const languages = ['hy', 'en'];

  it('creates one with the words given and the address left to the backend', () => {
    const values = announcementFormValues(null, languages);
    values.copy.en = {
      ...values.copy.en!,
      headline: ' Autumn Jazz Night ',
      summary: 'Jazz in the garden',
    };
    values.categories = 'concert, jazz, concert, ';
    expect(announcementBody(null, values, languages)).toEqual({
      headline: { en: 'Autumn Jazz Night' },
      summary: { en: 'Jazz in the garden' },
      categories: ['concert', 'jazz'],
    });
  });

  it('sends only what changed, a field emptied in one language without it, and a picture cleared as null', () => {
    const stored = listing({ heroAssetId: 'm1', summary: { en: 'Old', hy: 'Հին' } });
    const baseline = announcementFormValues(stored, languages);
    const values = {
      ...baseline,
      copy: { ...baseline.copy, hy: { ...baseline.copy.hy!, summary: '' } },
      heroAssetId: '',
      isIndexable: true,
    };
    expect(announcementBody(stored, values, languages)).toEqual({
      summary: { en: 'Old' },
      heroAssetId: null,
      isIndexable: true,
    });
  });

  it('sends a new address only when it changed, and never an empty one', () => {
    const stored = listing();
    const baseline = announcementFormValues(stored, languages);
    expect(announcementBody(stored, { ...baseline, slug: '' }, languages)).toEqual({});
    expect(announcementBody(stored, { ...baseline, slug: 'jazz-2027' }, languages)).toEqual({
      slug: 'jazz-2027',
    });
  });
});
