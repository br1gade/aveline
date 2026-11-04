import { afterEach, describe, expect, it, vi } from 'vitest';

import { organizationChoice } from './organization';

afterEach(() => {
  organizationChoice.clear();
  vi.restoreAllMocks();
});

describe('the organization this tab chose', () => {
  it('is none to start with', () => {
    expect(organizationChoice.read()).toBeUndefined();
  });

  it('is kept for this tab only', () => {
    organizationChoice.choose('org-1');
    expect(organizationChoice.read()).toBe('org-1');
    expect(window.sessionStorage.length).toBe(1);
    expect(window.localStorage.length).toBe(0);
  });

  it('is forgotten when cleared', () => {
    organizationChoice.choose('org-1');
    organizationChoice.clear();
    expect(organizationChoice.read()).toBeUndefined();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('holds in memory where the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('refused');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('refused');
    });
    organizationChoice.choose('org-2');
    expect(organizationChoice.read()).toBe('org-2');
  });
});
