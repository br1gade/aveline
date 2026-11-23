import { describe, expect, it } from 'vitest';

import { readServerEnv } from './env.server';

describe("the rendering server's settings", () => {
  it('reaches the API on the local address unless told another', () => {
    expect(readServerEnv({}).API_INTERNAL_URL).toBe('http://localhost:3000');
    expect(readServerEnv({ API_INTERNAL_URL: 'http://api:3000' }).API_INTERNAL_URL).toBe(
      'http://api:3000',
    );
  });

  it('refuses an address that is not one', () => {
    expect(() => readServerEnv({ API_INTERNAL_URL: 'not an address' })).toThrow();
  });
});
