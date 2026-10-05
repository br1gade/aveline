/**
 * CSV that Excel opens correctly.
 *
 * Two decisions that look like superstition and are not:
 *
 * - A UTF-8 BOM. Without it, Excel on Windows reads Armenian as mojibake, and
 *   the person who opens the file is a caterer, not a developer.
 * - CRLF line endings, which the RFC asks for and Excel is happiest with.
 *
 * Everything is quoted rather than only the fields that need it. A guest named
 * O'Brien, a note containing a comma and a phone number Excel would otherwise
 * read as a formula all become ordinary text.
 */
const BOM = '\uFEFF';

export type CsvRow = Record<string, string | number | null | undefined>;

export function toCsv(columns: readonly string[], rows: readonly CsvRow[]): string {
  const header = columns.map(quote).join(',');
  const body = rows.map((row) => columns.map((column) => quote(row[column])).join(','));

  return BOM + [header, ...body].join('\r\n') + '\r\n';
}

/**
 * A leading `=`, `+`, `-` or `@` makes Excel treat a cell as a formula, which
 * is how a spreadsheet export becomes an attack on whoever opens it. Prefixing
 * a tab keeps the text visible and inert.
 */
function quote(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';

  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `\t${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
