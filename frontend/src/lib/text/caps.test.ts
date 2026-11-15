import { describe, expect, it } from 'vitest';

import { capsSafe } from './caps';

describe('text set in capitals (audit F-32, design PD-197)', () => {
  it('spells the Armenian ligature out, so capitals read ԵՎ and not ԵՒ', () => {
    expect(capsSafe('Երևանի ժամանակով')).toBe('Երեվանի ժամանակով');
    expect(capsSafe('Երևանի ժամանակով').toUpperCase()).toBe('ԵՐԵՎԱՆԻ ԺԱՄԱՆԱԿՈՎ');
    expect(capsSafe('և և')).toBe('եվ եվ');
  });

  it('leaves every other language as it is', () => {
    for (const text of ['Yerevan time', 'по ереванскому времени', 'heure d’Erevan', '']) {
      expect(capsSafe(text)).toBe(text);
    }
  });
});
