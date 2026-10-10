import { appPage, isOnAppOrigin } from './app-url';

describe('isOnAppOrigin', () => {
  const env = { PUBLIC_APP_URL: 'https://app.aveline.am' };

  it.each(['https://app.aveline.am/tickets/return', 'https://app.aveline.am/billing/return?x=1'])(
    'accepts %s',
    (url) => {
      expect(isOnAppOrigin(url, env)).toBe(true);
    },
  );

  it.each([
    'https://evil.example/tickets/return',
    'https://app.aveline.am.evil.example/return',
    'http://app.aveline.am/tickets/return',
    'https://app.aveline.am:8443/return',
    '//evil.example/return',
    'javascript:alert(1)',
    'not a url',
    42,
  ])('refuses %s', (url) => {
    expect(isOnAppOrigin(url, env)).toBe(false);
  });

  it('falls back to the dev server when PUBLIC_APP_URL is unset', () => {
    expect(isOnAppOrigin('http://localhost:5173/tickets/return', {})).toBe(true);
    expect(appPage('/billing/return', {})).toBe('http://localhost:5173/billing/return');
  });
});
