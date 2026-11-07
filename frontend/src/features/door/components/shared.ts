import { useTranslation } from 'react-i18next';

import { formatEventTime } from '@/lib/time';

import type { DoorSeat } from '../types';

export const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

/** The kit's buttons never wrap; a long label in Armenian or Russian must, at 360 px. */
export const WRAPPING =
  'h-auto min-h-11 py-2 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11';

/** Times in the event's zone, on a 24-hour clock. */
export function useEventTime(timeZone: string) {
  const { i18n } = useTranslation('door');
  return (iso: string) => formatEventTime(iso, { timeZone, locale: i18n.language });
}

/** "Table 4 (Hall)" and the rest, one per plan: the table to point at. */
export function useSeatWords() {
  const { t } = useTranslation('door');
  return (seats: readonly DoorSeat[]) =>
    seats
      .map(({ table, venue }) =>
        venue ? t('seat.tableAt', { table, venue }) : t('seat.table', { table }),
      )
      .join(', ');
}
