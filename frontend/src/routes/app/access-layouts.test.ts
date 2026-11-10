import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { describe, expect, it } from 'vitest';

import { shouldRevalidate as eventAccessAgain } from './event-access';
import { shouldRevalidate as organizationAccessAgain } from './organization-access';

const move = (from: string, to: string) =>
  ({
    currentUrl: new URL(`http://app.test${from}`),
    nextUrl: new URL(`http://app.test${to}`),
    currentParams: { eventId: /\/events\/([^/]+)/.exec(from)?.[1] },
    nextParams: { eventId: /\/events\/([^/]+)/.exec(to)?.[1] },
    defaultShouldRevalidate: true,
  }) as ShouldRevalidateFunctionArgs;

describe('when an event’s permissions are read again (FR-6, design PD-190)', () => {
  it.each([
    ['another event', '/app/events/e1/guests', '/app/events/e2/guests', true],
    ['the page reading itself after a write', '/app/events/e1/team', '/app/events/e1/team', true],
    ['another page of the same event', '/app/events/e1/guests', '/app/events/e1/seating', false],
    ['a search on the same page', '/app/events/e1/guests', '/app/events/e1/guests?q=ani', false],
  ])('%s: %s', (_, from, to, isRead) => {
    expect(eventAccessAgain(move(from, to))).toBe(isRead);
  });
});

describe('when the organization’s permissions are read again (FR-6, design PD-190)', () => {
  it.each([
    ['the page reading itself after a write', '/app/billing', '/app/billing', true],
    [
      'leaving the organization’s own page, where membership changes',
      '/app/organization',
      '/app',
      true,
    ],
    ['another of its pages', '/app/billing', '/app/vendors', false],
    ['a search on the same page', '/app/vendors', '/app/vendors?category=MUSIC', false],
  ])('%s', (_, from, to, isRead) => {
    expect(organizationAccessAgain(move(from, to))).toBe(isRead);
  });
});
