import { describe, expect, it } from 'vitest';

import { isWorkbookFile } from './import-file';

const file = (bytes: number[] | string, name = 'guests.csv') =>
  new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name);

describe('a workbook saved under a .csv name (audit F-31)', () => {
  it('is known by its first bytes, a zip archive’s', async () => {
    expect(await isWorkbookFile(file([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(true);
  });

  it('leaves real CSV alone, with or without a byte-order mark', async () => {
    expect(await isWorkbookFile(file('First name,Last name\nAni,Grigoryan\n'))).toBe(false);
    expect(await isWorkbookFile(file('﻿PK,Name\n'))).toBe(false);
    expect(await isWorkbookFile(file(''))).toBe(false);
  });
});
