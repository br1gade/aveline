import { describe, expect, it } from 'vitest';

import { fromAcceptLanguage, LANGUAGE_COOKIE, negotiateLanguage } from './negotiate';

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('fromAcceptLanguage', () => {
  it.each([
    ['hy-AM,hy;q=0.9,en;q=0.8', 'hy'],
    ['en-GB,en;q=0.9', 'en'],
    ['de-DE,ru;q=0.7,en;q=0.5', 'ru'],
    ['en;q=0.4,ru;q=0.9', 'ru'],
    ['fr,de', 'en'],
    ['hy;q=0,ru', 'ru'],
    ['', 'en'],
  ])('%s → %s', (header, expected) => {
    expect(fromAcceptLanguage(header)).toBe(expected);
  });

  it('falls back to English with no header', () => {
    expect(fromAcceptLanguage(null)).toBe('en');
  });
});

describe('negotiateLanguage', () => {
  it('takes ?lang first, and remembers it in a cookie', () => {
    const result = negotiateLanguage(
      request('http://app/sign-in?lang=hy', {
        'accept-language': 'ru',
        cookie: `${LANGUAGE_COOKIE}=en`,
      }),
    );
    expect(result.language).toBe('hy');
    expect(result.setCookie).toBe(`${LANGUAGE_COOKIE}=hy; Path=/; Max-Age=31536000; SameSite=Lax`);
  });

  it('marks the cookie Secure over https', () => {
    expect(negotiateLanguage(request('https://app/sign-in?lang=ru')).setCookie).toMatch(
      /; Secure$/,
    );
  });

  it('then the remembered choice, without setting it again', () => {
    expect(
      negotiateLanguage(
        request('http://app/app', {
          cookie: `other=1; ${LANGUAGE_COOKIE}=ru`,
          'accept-language': 'en',
        }),
      ),
    ).toEqual({ language: 'ru' });
  });

  it('then the browser, ignoring a ?lang or cookie it does not know', () => {
    expect(
      negotiateLanguage(
        request('http://app/sign-in?lang=xx', {
          cookie: `${LANGUAGE_COOKIE}=de`,
          'accept-language': 'hy',
        }),
      ),
    ).toEqual({ language: 'hy' });
  });
});
