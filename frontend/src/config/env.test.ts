import { describe, expect, it } from 'vitest';

import { readPublicEnv } from './env';

describe('the public settings for support and the site', () => {
  it('leaves every contact and the site unset by default', () => {
    const env = readPublicEnv({});
    expect(env.VITE_SUPPORT_EMAIL).toBe('');
    expect(env.VITE_SUPPORT_PHONE).toBe('');
    expect(env.VITE_SUPPORT_WHATSAPP).toBe('');
    expect(env.VITE_SUPPORT_TELEGRAM).toBe('');
    expect(env.VITE_SITE_URL).toBe('');
  });

  it('takes contacts in their expected shapes', () => {
    const env = readPublicEnv({
      VITE_SUPPORT_EMAIL: ' help@example.am ',
      VITE_SUPPORT_PHONE: '+37410123456',
      VITE_SUPPORT_WHATSAPP: '+37491123456',
      VITE_SUPPORT_TELEGRAM: 'aveline_help',
      VITE_SITE_URL: 'https://example.am',
    });
    expect(env.VITE_SUPPORT_EMAIL).toBe('help@example.am');
    expect(env.VITE_SUPPORT_TELEGRAM).toBe('aveline_help');
  });

  it.each([
    ['VITE_SUPPORT_EMAIL', 'not an address'],
    ['VITE_SUPPORT_PHONE', '010 12 34 56'],
    ['VITE_SUPPORT_WHATSAPP', '+0123'],
    ['VITE_SUPPORT_TELEGRAM', '@aveline'],
    ['VITE_SUPPORT_TELEGRAM', 'abc'],
    ['VITE_SITE_URL', 'aveline.am'],
    ['VITE_SITE_URL', 'javascript:alert(1)'],
  ])('refuses %s set to %j, loudly', (name, value) => {
    expect(() => readPublicEnv({ [name]: value })).toThrow();
  });
});
