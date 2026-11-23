import { BadRequestException } from '@nestjs/common';
import { cursorPage, readCursor, readDatedCursor } from './cursor-pagination';

const FILTERS = { domain: 'invoices', organizationId: 'organization-1' };
const FIRST = { id: 'first', createdAt: new Date('2027-01-01T00:00:00.000Z') };
const SECOND = { id: 'second', createdAt: new Date('2027-01-01T00:00:00.000Z') };

describe('cursor pagination', () => {
  it('returns the requested rows and a continuation after the last visible row', () => {
    const page = cursorPage([FIRST, SECOND], 1, FILTERS, (row) => ({ id: row.id, at: row.createdAt }));
    expect(page.items).toEqual([FIRST]);
    expect(readCursor(page.nextCursor!, FILTERS)).toEqual({ id: FIRST.id, at: FIRST.createdAt });
  });

  it('does not offer a continuation when no further row exists', () => {
    expect(cursorPage([FIRST], 1, FILTERS, (row) => ({ id: row.id, at: row.createdAt })))
      .toEqual({ items: [FIRST], nextCursor: null });
  });

  it('represents the final group of legacy rows with no date', () => {
    const page = cursorPage([{ id: 'legacy' }, { id: 'next' }], 1, FILTERS, (row) => ({ id: row.id, at: null }));
    expect(readCursor(page.nextCursor!, FILTERS)).toEqual({ id: 'legacy', at: null });
    expect(() => readDatedCursor(page.nextCursor!, FILTERS)).toThrow(BadRequestException);
  });

  it('refuses a cursor reused for another tenant or another filter', () => {
    const page = cursorPage([FIRST, SECOND], 1, FILTERS, (row) => ({ id: row.id, at: row.createdAt }));
    expect(() => readCursor(page.nextCursor!, { ...FILTERS, organizationId: 'organization-2' })).toThrow(BadRequestException);
    expect(() => readCursor(page.nextCursor!, { ...FILTERS, status: 'PAID' })).toThrow(BadRequestException);
  });

  it.each(['not-base64-json', Buffer.from('null').toString('base64url'), Buffer.from('{}').toString('base64url')])(
    'refuses malformed cursor %s', (cursor) => expect(() => readCursor(cursor, FILTERS)).toThrow(BadRequestException),
  );

  it.each([{ at: 'tomorrow', id: 'one' }, { at: null, id: '' }, { at: null, id: '../outside' }])(
    'refuses an invalid boundary', (boundary) => {
      const page = cursorPage([FIRST, SECOND], 1, FILTERS, (row) => ({ id: row.id, at: row.createdAt }));
      const payload = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString()) as Record<string, unknown>;
      const cursor = Buffer.from(JSON.stringify({ ...payload, ...boundary })).toString('base64url');
      expect(() => readCursor(cursor, FILTERS)).toThrow(BadRequestException);
    },
  );
});
