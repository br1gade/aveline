import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { publishedWedding } from './support/factories';
import { expect, test } from './support/fixtures';

/** What a file of each format begins with. */
const MAGIC = {
  PDF: (bytes: Buffer) => bytes.subarray(0, 5).toString('latin1') === '%PDF-',
  // An XLSX is a zip, whose first four bytes are "PK" then 3 and 4.
  XLSX: (bytes: Buffer) => bytes.readUInt32LE(0) === 0x04034b50,
  CSV: (bytes: Buffer) =>
    bytes
      .toString('utf8')
      .replace(/^\uFEFF/u, '')
      .includes('Petrosyan'),
} as const;

type Format = keyof typeof MAGIC;

async function makeExport(page: Page, format: Format): Promise<void> {
  await page.getByRole('radio', { name: /^Guest list/u }).check();
  await page
    .getByRole('radio', { name: new RegExp(`^${format === 'XLSX' ? 'Spreadsheet' : format}`, 'u') })
    .check();
  await page.getByRole('button', { name: 'Make the export' }).click();
}

/**
 * Exports (pilot Milestone D; docs/API.md §6, "Exports"): a guest list made by the backend's
 * worker in each format, downloaded while signed in, and the file checked for what it is.
 */
test.describe('exports', () => {
  test('makes the guest list as PDF, spreadsheet and CSV, and downloads each', async ({
    page,
    host,
    signedIn,
  }) => {
    test.slow();
    const { event } = await publishedWedding(host);
    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/exports`);

    for (const format of ['PDF', 'XLSX', 'CSV'] as const) {
      await makeExport(page, format);
      const row = page
        .getByRole('listitem')
        .filter({ hasText: `Guest list (${format})` })
        .first();
      await expect(row.getByText('Ready to download')).toBeVisible({ timeout: 60_000 });
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        row.getByRole('button', { name: /^Download/u }).click(),
      ]);
      const bytes = await readFile(await download.path());
      expect(MAGIC[format](bytes), `${format} file`).toBe(true);
    }
  });
});
