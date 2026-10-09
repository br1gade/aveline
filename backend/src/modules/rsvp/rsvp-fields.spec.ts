import { builtInAnswerProblem, configProblem, fieldOf, fieldsForPage, mergeConfig, optionLabel } from './rsvp-fields';

const drinks = {
  drinkPreference: {
    isEnabled: true,
    options: [
      { key: 'wine', label: { hy: 'Գինի', en: 'Wine', ru: 'Вино' } },
      { key: 'soft', label: { en: 'Soft drinks' } },
    ],
  },
  songRequest: { isEnabled: false, options: null },
};

describe('fieldOf', () => {
  it('asks everything, as free text, when nothing is configured', () => {
    expect(fieldOf({}, 'dietary')).toEqual({ isEnabled: true, options: null });
    expect(fieldOf(null, 'message')).toEqual({ isEnabled: true, options: null });
  });
});

describe('configProblem', () => {
  it('accepts switching a question off and giving drink fixed choices', () => {
    expect(configProblem(drinks)).toBeNull();
  });

  it.each([
    [{ shoeSize: { isEnabled: false } }, /^shoeSize: not a built-in/],
    [{ songRequest: { options: [{ key: 'a', label: { en: 'A' } }] } }, /only dietary and drinkPreference/],
    [{ drinkPreference: { options: [{ key: 'Red Wine', label: { en: 'x' } }] } }, /lowercase letters/],
    [{ drinkPreference: { options: [{ key: 'wine', label: {} }] } }, /needs a label/],
    [{ drinkPreference: { options: [{ key: 'w', label: { en: 'A' } }, { key: 'w', label: { en: 'B' } }] } }, /twice/],
    [{ drinkPreference: { options: [] } }, /1 to 30/],
    [{ dietary: { isEnabled: 'yes' } }, /true or false/],
    [{ dietary: { colour: 'red' } }, /only isEnabled and options/],
  ])('refuses %j, naming the field', (edit, message) => {
    expect(configProblem(edit)).toMatch(message);
  });
});

describe('mergeConfig', () => {
  it('replaces only the fields sent, and returns one to free text with options: null', () => {
    const merged = mergeConfig(drinks, { drinkPreference: { options: null }, dietary: { isEnabled: false } });
    expect(merged.drinkPreference).toEqual({ isEnabled: true, options: null });
    expect(merged.dietary).toEqual({ isEnabled: false, options: null });
    expect(merged.songRequest).toEqual({ isEnabled: false, options: null });
  });
});

describe('builtInAnswerProblem', () => {
  it('accepts a choice by its key, and free text where there are no choices', () => {
    expect(builtInAnswerProblem(drinks, { drinkPreference: 'wine', message: 'Congratulations' })).toBeNull();
  });

  it.each([
    [{ drinkPreference: 'Wine' }, /^drinkPreference: choose from wine, soft/],
    [{ songRequest: 'Sirun Yar' }, /^songRequest: this invitation does not ask/],
  ])('refuses %j', (answer, message) => {
    expect(builtInAnswerProblem(drinks, answer)).toMatch(message);
  });

  // A form that sends an empty field for a question it does not show is not answering it.
  it('ignores an empty answer to a question that is switched off', () => {
    expect(builtInAnswerProblem(drinks, { songRequest: '', dietary: [] })).toBeNull();
  });
});

describe('fieldsForPage and optionLabel', () => {
  it('labels choices in the page’s language', () => {
    const page = fieldsForPage(drinks, 'ru', 'hy');
    expect(page.drinkPreference).toEqual({
      isEnabled: true,
      options: [
        { key: 'wine', label: 'Вино' },
        { key: 'soft', label: 'Soft drinks' },
      ],
    });
    expect(page.songRequest).toEqual({ isEnabled: false, options: null });
  });

  it('shows a stored key as its label, and free text as typed', () => {
    expect(optionLabel(drinks, 'drinkPreference', 'wine', 'en')).toBe('Wine');
    expect(optionLabel(drinks, 'drinkPreference', 'homemade cognac', 'en')).toBe('homemade cognac');
  });
});
