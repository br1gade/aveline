import { corsOptionsFor } from './cors';

describe('corsOptionsFor', () => {
  it('names its origins in production and refuses every other one by default', () => {
    expect(corsOptionsFor(false, { CORS_ORIGINS: 'https://aveline.am, https://www.aveline.am' }).origin)
      .toEqual(['https://aveline.am', 'https://www.aveline.am']);
    expect(corsOptionsFor(false, {}).origin).toBe(false);
  });

  it('allows any origin where development shortcuts are allowed', () => {
    expect(corsOptionsFor(true, {}).origin).toBe(true);
  });

  // FR-10: a client on another origin can quote the request id in an error
  // report, and does not preflight every write.
  it('exposes the request id and caches a preflight', () => {
    expect(corsOptionsFor(false, {})).toMatchObject({ credentials: true, exposedHeaders: ['x-request-id'], maxAge: 600 });
  });
});
