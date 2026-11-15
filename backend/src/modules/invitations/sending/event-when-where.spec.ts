import { eventWhenAndWhere } from './event-wording';

/**
 * An invitation that says only "you are invited" and a link reads as
 * phishing (audit F-10). It says when and where, in the event's time zone
 * and the reader's language.
 */
describe('eventWhenAndWhere', () => {
  const event = {
    startsAt: new Date('2027-06-12T14:00:00.000Z'),
    timezone: 'Asia/Yerevan',
    venues: [
      { name: 'Սուրբ Գայանե', address: 'Էջմիածին', translations: { en: { name: 'Saint Gayane', address: 'Etchmiadzin' } } },
      { name: 'Ararat Hall', address: 'Yerevan', translations: {} },
    ],
  };

  it('gives the date in the event’s time zone, not the server’s', () => {
    expect(eventWhenAndWhere(event, 'en').eventDate).toBe('June 12, 2027 at 6:00 PM');
  });

  it.each([
    ['ru', '12 июня 2027 г. в 18:00'],
    ['hy', '12 հունիսի, 2027 թ., 18:00'],
  ])('writes the date as a %s reader writes it', (locale, expected) => {
    expect(eventWhenAndWhere(event, locale).eventDate).toBe(expected);
  });

  it('names the first venue in the reader’s language when the host wrote one', () => {
    expect(eventWhenAndWhere(event, 'en').place).toBe('Saint Gayane, Etchmiadzin');
    expect(eventWhenAndWhere(event, 'ru').place).toBe('Սուրբ Գայանե, Էջմիածին');
  });

  it('gives no place for an event with no venue yet', () => {
    expect(eventWhenAndWhere({ ...event, venues: [] }, 'en').place).toBe('');
  });
});
