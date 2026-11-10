import { describe, expect, it } from 'vitest';

import { expectFile, filenameFromDisposition } from './file';

describe('the filename a download names', () => {
  it.each([
    ['attachment; filename="guest-list-c1.pdf"', 'guest-list-c1.pdf'],
    ['attachment; filename=guest-list-c1.csv', 'guest-list-c1.csv'],
    ['attachment;filename="a \\"b\\".xlsx"', 'a "b".xlsx'],
    ["attachment; filename*=UTF-8''%D5%B0%D5%B5%D5%B8%D6%82%D6%80%D5%A5%D6%80.pdf", 'հյուրեր.pdf'],
    ['attachment; filename="fallback.pdf"; filename*=UTF-8\'\'%C3%A9t%C3%A9.pdf', 'été.pdf'],
    ['attachment; filename="../../etc/passwd"', 'passwd'],
  ])('reads %s as %s', (header, name) => {
    expect(filenameFromDisposition(header)).toBe(name);
  });

  it.each([
    null,
    '',
    'attachment',
    'attachment; filename=""',
    "attachment; filename*=UTF-8''%E0%A4",
  ])('has none in %j', (header) => {
    expect(filenameFromDisposition(header)).toBeUndefined();
  });
});

function answer(body: BodyInit | null, init: ResponseInit) {
  return { response: new Response(body, init) };
}

describe('a file read through the API client', () => {
  it('keeps the bytes, their type and the name the server gave', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const headers = {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="guest-list-c1.pdf"',
    };
    const file = await expectFile(
      Promise.resolve({ data: blob, ...answer(null, { status: 200, headers }) }),
    );
    expect(file).toEqual({ blob, contentType: 'application/pdf', filename: 'guest-list-c1.pdf' });
  });

  it('has no name when the response has no Content-Disposition', async () => {
    const blob = new Blob(['a,b'], { type: 'text/csv' });
    const file = await expectFile(
      Promise.resolve({ data: blob, ...answer(null, { status: 200 }) }),
    );
    expect(file.filename).toBeUndefined();
    expect(file.contentType).toBe('text/csv');
  });

  it('throws the API error the response carried', async () => {
    const body = {
      statusCode: 410,
      message: 'This snapshot expired; regenerate it',
      code: 'EXPIRED',
    };
    await expect(
      expectFile(
        Promise.resolve({
          error: body,
          ...answer(null, { status: 410, headers: { 'x-request-id': 'req-1' } }),
        }),
      ),
    ).rejects.toMatchObject({ status: 410, code: 'EXPIRED', requestId: 'req-1' });
  });

  it('throws a network error, status 0, when nothing came back', async () => {
    await expect(expectFile(Promise.reject(new TypeError('offline')))).rejects.toMatchObject({
      status: 0,
    });
  });
});
