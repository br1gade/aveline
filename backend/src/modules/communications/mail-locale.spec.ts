import { mailLocale } from './mail-locale';

/**
 * Which language a message is written in, when its copy may not have the
 * reader's (audit F-02; decided 14 November 2026): the reader's, then the
 * event's, then English, then whatever the copy has.
 */
describe('mailLocale', () => {
  const copy = { hy: 'Հրավեր', en: 'Invitation', ru: 'Приглашение' };

  it.each([
    ['the reader’s language when the copy has it', 'ru', 'hy', 'ru'],
    ['the event’s language when the copy lacks the reader’s', 'fr', 'hy', 'hy'],
    ['English when it has neither', 'fr', 'de', 'en'],
    ['English when there is no event', 'fr', undefined, 'en'],
  ])('writes in %s', (_case, reader, event, expected) => {
    expect(mailLocale(copy, reader, event)).toBe(expected);
  });

  it('falls back to the first language the copy has when it has no English', () => {
    expect(mailLocale({ hy: 'Հրավեր', ru: 'Приглашение' }, 'fr', undefined)).toBe('hy');
  });
});
