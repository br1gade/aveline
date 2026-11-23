// @vitest-environment-options {"url":"https://app.aveline.am/app/events/e1/guests"}
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyCapabilityLink, isSendableOrigin } from './copy-link';

describe('where a capability link may be sent from', () => {
  it.each([
    ['https://app.aveline.am', 'https://app.aveline.am/app/events/e1/vendors/b1', true],
    ['http://localhost:5173', 'http://localhost:5173/app', true],
    ['http://localhost:5173', 'https://app.aveline.am/app', false],
    ['http://127.0.0.1:5173', 'https://app.aveline.am/app', false],
    ['http://app.aveline.am', 'https://app.aveline.am/app', false],
    ['http://staging.aveline.test', 'http://staging.aveline.test/app', true],
    ['http://localhost:5173', 'http://staging.aveline.test/app', false],
    ['https://localhost:5173', 'https://app.aveline.am/app', false],
    ['http://[::1]:5173', 'https://app.aveline.am/app', false],
  ])('a link on %s, copied from %s: %s', (origin, page, isSendable) => {
    expect(isSendableOrigin(origin, page)).toBe(isSendable);
  });
});

describe('copying a capability link', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('copies nothing, and says so, from a real page when the build doesn’t know its public origin', async () => {
    vi.stubEnv('VITE_PUBLIC_ORIGIN', 'http://localhost:5173');
    const linkOn = vi.fn((origin: string) => `${origin}/briefs/t`);
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    });
    expect(await copyCapabilityLink(linkOn)).toBe('unsendable');
    expect(linkOn).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('copies the link on the public origin', async () => {
    vi.stubEnv('VITE_PUBLIC_ORIGIN', 'https://app.aveline.am');
    const write = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    });
    expect(await copyCapabilityLink((origin) => `${origin}/briefs/t`)).toBe('copied');
    expect(write).toHaveBeenCalledWith('https://app.aveline.am/briefs/t');
  });
});
