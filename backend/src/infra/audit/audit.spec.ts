import { actionNameFor, isAuditable, normalizeRoute } from './audit';

const request = (method: string, route: string) => ({ method, route });

describe('isAuditable', () => {
  // Reads are the overwhelming majority of traffic; recording them would bury
  // the handful of writes someone has to account for.
  it.each(['GET', 'HEAD', 'OPTIONS'])('ignores %s', (method) => {
    expect(isAuditable(request(method, '/api/v1/events/:id/guests'))).toBe(false);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('records %s', (method) => {
    expect(isAuditable(request(method, '/api/v1/events/:id/guests'))).toBe(true);
  });

  it('is not confused by a lower-case method', () => {
    expect(isAuditable(request('post', '/api/v1/events'))).toBe(true);
  });

  describe('exclusions', () => {
    /**
     * Authentication writes constantly and keeps its own, more detailed
     * records in Session; webhooks have no human actor to record.
     */
    it.each([
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/webhooks/telegram',
      '/api/v1/payments/reconcile',
      '/api/v1/ticket-orders/release-expired',
    ])('excludes %s', (route) => {
      expect(isAuditable(request('POST', route))).toBe(false);
    });

    // The things most worth accounting for must not be caught by a prefix.
    it.each([
      '/api/v1/payments',
      '/api/v1/payments/:orderNumber/refund',
      '/api/v1/organization/invites',
      '/api/v1/privacy/requests/:id/fulfil',
      '/api/v1/promo-codes',
    ])('still records %s', (route) => {
      expect(isAuditable(request('POST', route))).toBe(true);
    });
  });
});

describe('normalizeRoute', () => {
  // An audit query should not have to know which API version was used.
  it.each([
    { route: '/api/v1/events', expected: '/events' },
    { route: '/api/v2/events', expected: '/events' },
    { route: '/api/v10/events', expected: '/events' },
    { route: '/events', expected: '/events' },
  ])('$route → $expected', ({ route, expected }) => {
    expect(normalizeRoute(route)).toBe(expected);
  });
});

describe('actionNameFor', () => {
  it.each([
    { method: 'POST', route: '/api/v1/events', expected: 'events.create' },
    {
      method: 'POST',
      route: '/api/v1/events/:eventId/guests/import',
      expected: 'events.guests.import.create',
    },
    { method: 'PATCH', route: '/api/v1/promo-codes/:codeId', expected: 'promo-codes.update' },
    { method: 'DELETE', route: '/api/v1/suppressions/:id', expected: 'suppressions.delete' },
  ])('$method $route → $expected', ({ method, route, expected }) => {
    expect(actionNameFor(request(method, route))).toBe(expected);
  });

  // Stable when a path parameter is renamed, so a trail stays groupable.
  it('ignores path parameter names', () => {
    expect(actionNameFor(request('PATCH', '/api/v1/events/:id/settings'))).toBe(
      actionNameFor(request('PATCH', '/api/v1/events/:eventId/settings')),
    );
  });

  it('falls back to a generic verb for an unexpected method', () => {
    expect(actionNameFor(request('PROPFIND', '/api/v1/events'))).toBe('events.change');
  });
});
