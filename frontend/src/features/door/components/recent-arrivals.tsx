import { useTranslation } from 'react-i18next';

import type { ArrivalCounts } from '../types';
import { useEventTime } from './shared';

/** The API's last twenty. It names no ids, so nothing can be undone from here (FR-80). */
export function RecentArrivals({ counts, timeZone }: { counts: ArrivalCounts; timeZone: string }) {
  const { t } = useTranslation('door');
  const timeOf = useEventTime(timeZone);
  if (counts.recent.length === 0) return null;
  return (
    <details className="border-border border-t pt-2">
      <summary className="flex min-h-11 cursor-pointer items-center font-medium">
        {t('recent.title')}
      </summary>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 pt-1">
        {counts.recent.map(({ name, arrivedAt }) => (
          <li key={`${name}-${arrivedAt}`} className="flex justify-between gap-3 text-sm">
            <span className="break-words">{name}</span>
            <span className="text-muted-foreground shrink-0">{timeOf(arrivedAt)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
