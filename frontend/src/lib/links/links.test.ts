import { describe, expect, it } from 'vitest';

import { safeExternalUrl } from './links';

describe('links from host content', () => {
  it.each([
    ['https://maps.example.com/x', 'https://maps.example.com/x'],
    ['http://example.com/', 'http://example.com/'],
    ['javascript:alert(1)', undefined],
    ['data:text/html,hi', undefined],
    ['ftp://example.com/file', undefined],
    ['not a url', undefined],
    [null, undefined],
  ])('safeExternalUrl(%j) is %j', (input, expected) => {
    expect(safeExternalUrl(input)).toBe(expected);
  });
});
