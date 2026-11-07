import type { TFunction } from 'i18next';

import type { RowError } from '../types';

/**
 * The rows an import refused, by the spreadsheet's own numbers, never renumbered (docs/API.md §6).
 * Row 0 is the file itself. The reasons are the backend's English sentences (FR-26), marked so a
 * screen reader reads them as English.
 */
export function RefusedRows({
  errors,
  t,
}: {
  errors: readonly RowError[];
  t: TFunction<'guests'>;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
      {errors.map((error, position) => (
        <li key={position} className="flex flex-wrap gap-x-2">
          <span className="font-medium">
            {error.row === 0 ? t('import.file') : t('import.row', { row: String(error.row) })}
          </span>
          <span lang="en">{error.message}</span>
          {error.value ? (
            <span className="text-muted-foreground break-all">
              {t('import.value', { value: error.value })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
