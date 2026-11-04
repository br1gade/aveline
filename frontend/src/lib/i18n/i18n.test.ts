import { describe, expect, it } from 'vitest';

import { addStrings } from '@/locales/registry';

import { createI18n } from './i18n';

describe('strings a route adds as it loads', () => {
  it('reach an instance made before they arrived', () => {
    const i18n = createI18n('en');
    expect(i18n.exists('later-page:title')).toBe(false);
    addStrings({ en: { 'later-page': { title: 'Here now' } } });
    expect(i18n.exists('later-page:title')).toBe(true);
    expect(i18n.getResource('en', 'later-page', 'title')).toBe('Here now');
  });

  it('fall back to English, as the rest do', () => {
    addStrings({ en: { 'english-only-page': { only: 'In English' } } });
    expect(createI18n('hy').exists('english-only-page:only')).toBe(true);
  });
});
