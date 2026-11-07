import { describe, expect, it } from 'vitest';

import { assignKeys, keyFromLabels } from './option-keys';

describe('keyFromLabels', () => {
  it('takes the first label in Latin letters, without accents, in lowercase with dashes', () => {
    expect(keyFromLabels(['Գինի', 'Vin rouge ', 'Red wine'])).toBe('vin-rouge');
    expect(keyFromLabels(['Café crème!'])).toBe('cafe-creme');
    expect(keyFromLabels(['  Soft drinks / juice '])).toBe('soft-drinks-juice');
  });

  it('gives nothing for labels in Armenian or Cyrillic only', () => {
    expect(keyFromLabels(['Գինի', 'Вино'])).toBeNull();
    expect(keyFromLabels(['', '   '])).toBeNull();
  });

  it('keeps a key within forty characters, never ending on a dash', () => {
    const key = keyFromLabels(['A very long name for a drink that nobody could ever remember']);
    expect(key).toBe('a-very-long-name-for-a-drink-that-nobody');
    expect(key?.length).toBeLessThanOrEqual(40);
  });
});

describe('assignKeys', () => {
  it('keeps saved keys, makes new ones unique, and numbers those with no Latin label', () => {
    expect(
      assignKeys([
        { key: 'wine', labels: ['Wine'] },
        { key: '', labels: ['Wine'] },
        { key: '', labels: ['Вода'] },
        { key: '', labels: ['Wine'] },
      ]),
    ).toEqual(['wine', 'wine-2', 'choice-3', 'wine-3']);
  });

  it('never takes a saved key for a new choice, whatever the order', () => {
    expect(
      assignKeys([
        { key: '', labels: ['Beer'] },
        { key: 'beer', labels: ['Lager'] },
      ]),
    ).toEqual(['beer-2', 'beer']);
  });
});
