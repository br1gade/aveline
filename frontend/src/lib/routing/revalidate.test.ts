import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { describe, expect, it } from 'vitest';

import { revalidateOnLanguage, revalidateUnlessQueryOnly } from './revalidate';

const ORIGIN = 'http://app.test';

function move(from: string, to: string, defaultShouldRevalidate = true) {
  return {
    currentUrl: new URL(from, ORIGIN),
    nextUrl: new URL(to, ORIGIN),
    defaultShouldRevalidate,
  } as ShouldRevalidateFunctionArgs;
}

describe('revalidateUnlessQueryOnly', () => {
  it('keeps the data when only the query changes: a search typed on the same page', () => {
    expect(
      revalidateUnlessQueryOnly(move('/app/events/e1/guests', '/app/events/e1/guests?q=an')),
    ).toBe(false);
    expect(
      revalidateUnlessQueryOnly(
        move('/app/events/e1/guests?q=an', '/app/events/e1/guests?answer=pending'),
      ),
    ).toBe(false);
  });

  it('reloads on an explicit revalidation, where the address does not change', () => {
    expect(
      revalidateUnlessQueryOnly(move('/app/events/e1/guests?q=an', '/app/events/e1/guests?q=an')),
    ).toBe(true);
  });

  it('leaves another page to React Router', () => {
    expect(revalidateUnlessQueryOnly(move('/app/events/e1', '/app/events/e1/guests'))).toBe(true);
    expect(revalidateUnlessQueryOnly(move('/app/events/e1', '/app/events/e2', false))).toBe(false);
  });
});

describe('revalidateOnLanguage', () => {
  it('negotiates again when the switcher sets another language', () => {
    expect(
      revalidateOnLanguage(move('/app/events/e1/guests', '/app/events/e1/guests?lang=ru')),
    ).toBe(true);
    expect(revalidateOnLanguage(move('/app?lang=ru', '/app/events/e1'))).toBe(true);
  });

  it('keeps the language through a search, another page or an explicit revalidation', () => {
    expect(
      revalidateOnLanguage(
        move('/app/events/e1/guests?lang=ru', '/app/events/e1/guests?lang=ru&q=an'),
      ),
    ).toBe(false);
    expect(revalidateOnLanguage(move('/app/events/e1', '/app/events/e1/guests'))).toBe(false);
    expect(revalidateOnLanguage(move('/app/events/e1/guests', '/app/events/e1/guests'))).toBe(
      false,
    );
  });
});
