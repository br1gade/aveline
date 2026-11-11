import type { TFunction } from 'i18next';

import type { RowError } from '../types';

/** A reason in the page's language; one with no code, as older history can hold, as it came. */
function Reason({ error, t }: { error: RowError; t: TFunction<'guests'> }) {
  if (!error.reason) return <span lang="en">{error.message}</span>;
  const field = error.field ? t(`import.fields.${error.field}`) : t('import.fields.unknown');
  return <span>{t(`import.reasons.${error.reason}`, { field })}</span>;
}

/**
 * The rows an import refused, by the spreadsheet's own numbers, never renumbered (docs/API.md §6).
 * Row 0 is the file itself. Each reason is worded from the backend's code (FR-26).
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
          <Reason error={error} t={t} />
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
