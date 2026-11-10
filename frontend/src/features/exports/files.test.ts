import { describe, expect, it } from 'vitest';

import { fileNameOf, isExpectedType } from './files';
import { snapshot } from './test-data';

describe('the file a download hands over', () => {
  it.each([
    ['PDF', 'application/pdf', true],
    ['XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', true],
    ['CSV', 'text/csv; charset=utf-8', true],
    ['CSV', 'Text/CSV', true],
    ['PDF', 'text/html; charset=utf-8', false],
    ['XLSX', 'application/json', false],
    ['CSV', '', false],
  ] as const)('takes a %s answered as %j: %s', (format, type, expected) => {
    expect(isExpectedType(format, type)).toBe(expected);
  });

  it('keeps the name the server gave', () => {
    expect(fileNameOf(snapshot(), 'guest-list-s1.pdf')).toBe('guest-list-s1.pdf');
  });

  it('names it as the backend does when the response has no Content-Disposition', () => {
    expect(fileNameOf(snapshot({ kind: 'PLACE_CARDS', format: 'XLSX' }), undefined)).toBe(
      'place-cards-s1.xlsx',
    );
    expect(fileNameOf(snapshot({ kind: 'TICKET_MANIFEST', format: 'CSV' }), undefined)).toBe(
      'ticket-manifest-s1.csv',
    );
  });
});
