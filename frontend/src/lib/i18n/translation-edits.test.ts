import { describe, expect, it } from 'vitest';

import {
  labelEdits,
  translatedLanguages,
  translationEdits,
  translationValues,
} from './translation-edits';

const FIELDS = ['title', 'hostsLabel'] as const;

describe('translationValues', () => {
  it('gives every language asked for each field, empty where nothing is stored', () => {
    const stored = { ru: { title: 'Свадьба' }, en: null, xx: 'nonsense' };
    expect(translationValues(stored, ['ru', 'en'], FIELDS)).toEqual({
      ru: { title: 'Свадьба', hostsLabel: '' },
      en: { title: '', hostsLabel: '' },
    });
  });

  it('reads nothing from a map that is not one', () => {
    expect(translationValues(null, ['fr'], FIELDS)).toEqual({ fr: { title: '', hostsLabel: '' } });
  });
});

describe('translationEdits', () => {
  const stored = { ru: { title: 'Свадьба', hostsLabel: 'Анна и Давид' }, en: { title: 'Wedding' } };

  it('sends nothing when nothing changed, blanks and spaces included', () => {
    const values = {
      ru: { title: ' Свадьба ', hostsLabel: 'Анна и Давид' },
      en: { title: 'Wedding', hostsLabel: '' },
      fr: { title: '', hostsLabel: '  ' },
    };
    expect(translationEdits(stored, values, FIELDS)).toEqual({});
  });

  it('sends a changed language whole, since the backend replaces a language whole', () => {
    const values = {
      ru: { title: 'Свадьба Анны', hostsLabel: 'Анна и Давид' },
      en: { title: 'Wedding', hostsLabel: '' },
    };
    expect(translationEdits(stored, values, FIELDS)).toEqual({
      ru: { title: 'Свадьба Анны', hostsLabel: 'Анна и Давид' },
    });
  });

  it('leaves a field emptied out of its language rather than sending it blank', () => {
    const values = { ru: { title: 'Свадьба', hostsLabel: '' } };
    expect(translationEdits(stored, values, FIELDS)).toEqual({ ru: { title: 'Свадьба' } });
  });

  it('removes a language whose every field was emptied', () => {
    const values = { en: { title: '', hostsLabel: '' } };
    expect(translationEdits(stored, values, FIELDS)).toEqual({ en: null });
  });

  it('adds a new language', () => {
    const values = { fr: { title: 'Mariage', hostsLabel: '' } };
    expect(translationEdits(stored, values, FIELDS)).toEqual({ fr: { title: 'Mariage' } });
  });

  it('never touches a stored language the form does not show', () => {
    expect(translationEdits(stored, {}, FIELDS)).toEqual({});
  });

  it('treats a stored language with only blank words as absent', () => {
    expect(
      translationEdits({ en: { title: ' ' } }, { en: { title: '', hostsLabel: '' } }, FIELDS),
    ).toEqual({});
  });
});

describe('labelEdits', () => {
  it('sends changed languages, null for one emptied, and nothing unchanged', () => {
    expect(
      labelEdits(
        { hy: 'Պսակ', en: 'Ceremony', ru: 'Венчание' },
        { hy: 'Պսակ', en: ' ', ru: 'Венчание!', fr: 'Cérémonie' },
      ),
    ).toEqual({ en: null, ru: 'Венчание!', fr: 'Cérémonie' });
  });

  it('sends a new entry’s non-blank languages only', () => {
    expect(labelEdits({}, { hy: '', en: 'Cake' })).toEqual({ en: 'Cake' });
  });
});

describe('translatedLanguages', () => {
  const stored = { en: { title: 'The wedding' }, fr: { title: 'Mariage' } };

  it('shows each of the event’s languages but the default', () => {
    expect(translatedLanguages(['hy', 'en', 'ru'], 'hy', stored, FIELDS)).toEqual(['en', 'ru']);
  });

  it('shows the default too, first, when it has words of its own', () => {
    expect(translatedLanguages(['hy', 'en'], 'en', stored, FIELDS)).toEqual(['en', 'hy']);
  });

  it('doesn’t count blank words as the default’s own', () => {
    expect(translatedLanguages(['en'], 'en', { en: { title: ' ' } }, FIELDS)).toEqual([]);
  });
});
