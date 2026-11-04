// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { plantedToken } from '../test/tokens';

import { canReachRouter, loggedError, loggedPath, requestLine } from './log.ts';

const token = plantedToken().toLowerCase();

describe('loggedPath', () => {
  it.each([
    [`/invitations/anna/g/${token}`, '/invitations/anna/g/[token]'],
    [`/invitations/anna/g/${token}.data`, '/invitations/anna/g/[token]'],
    [`/tickets/${token}`, '/tickets/[token]'],
    [`/briefs/${token}`, '/briefs/[token]'],
    [`/api/v1/ticket-orders/${token}/confirm`, '/api/v1/ticket-orders/[token]/confirm'],
    [`/api/v1/payments/${token}`, '/api/v1/payments/[order]'],
  ])('takes the credential out of %s', (url, expected) => {
    expect(loggedPath(url)).toBe(expected);
  });

  it.each([
    `/Tickets/${token}`,
    `/INVITATIONS/anna/G/${token}`,
    `/invitations/anna%2Fg%2F${token}`,
    `//tickets/${token}`,
    `http://evil.example/briefs/${token}`,
    `/tickets/./${token}`,
    `/tickets/%2e/${token}`,
    `/tickets\\${token}`,
    `/tickets%2F.%2F${token}`,
    `/tickets/../tickets/${token}`,
    `/tickets//${token}`,
    `/briefs//${token}`,
    `/devices//${token}`,
    `/invitations/anna//g/${token}`,
    `/invitations/anna/g//${token}`,
    `/api/v1/ticket-orders//${token}`,
    `/tickets/%2F${token}`,
    `/tickets%252F${token}`,
    `/invitations/anna%252Fg%252F${token}`,
    `/tickets%25252F${token}`,
  ])('still takes it out of %s, which the router or a client may send', (url) => {
    expect(loggedPath(url)).not.toContain(token);
  });

  it.each([
    `/reset-password?token=${token}`,
    `/billing/return?orderId=${token}`,
    `/app/events?q=${token}`,
    `/tickets/return?orderId=${token}&lang=en`,
  ])('drops the whole query of %s', (url) => {
    expect(loggedPath(url)).not.toContain(token);
    expect(loggedPath(url)).not.toContain('?');
  });

  it('keeps a path that names nobody', () => {
    expect(loggedPath('/invitations/anna')).toBe('/invitations/anna');
    expect(loggedPath('/assets/entry.js')).toBe('/assets/entry.js');
  });

  it('logs nothing of an address it cannot read', () => {
    expect(loggedPath(`/%E0%A4%A/${token}`)).toBe('[unreadable]');
  });
});

describe('requestLine', () => {
  it('is one line of JSON with the method, the redacted path, the status and the time', () => {
    const line = requestLine({
      method: 'GET',
      url: `/tickets/${token}?a=${token}`,
      status: 200,
      ms: 12,
    });
    expect(JSON.parse(line)).toEqual({
      method: 'GET',
      path: '/tickets/[token]',
      status: 200,
      ms: 12,
    });
    expect(line).not.toContain('\n');
  });

  it('reads the path however broken the query after it', () => {
    expect(loggedPath('/events?q=%zz')).toBe('/events');
  });

  it('reads no method it does not know into the log', () => {
    const line = requestLine({ method: token, url: '/', status: 400, ms: 0 });
    expect(line).not.toContain(token);
    expect(JSON.parse(line)).toMatchObject({ method: 'OTHER' });
  });
});

describe('loggedError', () => {
  it('redacts a capability path and a token query quoted in an error', () => {
    const error = new Error(`failed /invitations/a/g/${token} and /reset-password?token=${token}`);
    expect(loggedError(error)).not.toContain(token);
  });

  it.each([
    `failed on /Tickets/${token}`,
    `failed on /INVITATIONS/a/G/${token}`,
    `failed on /billing/return?orderId=${token}`,
    `failed on /billing/return?lang=hy&orderId=${token}`,
  ])('redacts %s', (text) => {
    expect(loggedError(new Error(text))).not.toContain(token);
  });

  it('reads something that is not an error', () => {
    expect(loggedError(`/tickets/${token}`)).toBe('/tickets/[token]');
  });
});

describe('what reaches the router at all', () => {
  it('lets a normal address through', () => {
    expect(canReachRouter(`/invitations/a/g/${token}?locale=hy`, 'aveline.am')).toBe(true);
    expect(canReachRouter('/', undefined)).toBe(true);
  });

  it.each([`/tickets/${token}%zz`, `/invitations/a/g/${token}%`])(
    'stops %s, which the router would warn about with the whole address',
    (url) => {
      expect(canReachRouter(url, 'aveline.am')).toBe(false);
    },
  );

  it('stops a Host no address can be made from, which the adapter would print with the path', () => {
    expect(canReachRouter(`/tickets/${token}`, 'a b')).toBe(false);
  });
});
