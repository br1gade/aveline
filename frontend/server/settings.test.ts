// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { requireSettings } from './settings.ts';

describe('what the production server needs to start', () => {
  it('starts with the API’s address', () => {
    expect(() => requireSettings({ API_INTERNAL_URL: 'http://api:3000' })).not.toThrow();
  });

  it.each([[{}], [{ API_INTERNAL_URL: '' }]])(
    'refuses %o, where every guest would be told their invitation doesn’t exist',
    (env) => {
      expect(() => requireSettings(env)).toThrow('API_INTERNAL_URL');
    },
  );
});
