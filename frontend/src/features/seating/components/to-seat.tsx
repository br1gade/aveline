import { useTranslation } from 'react-i18next';

import type { Loaded } from '@/api/loaded';
import type { Household } from '@/features/guests';
import { LoadedProblem } from '@/features/sending';
import { Button } from '@/ui/kit/button';

import type { HouseholdToSeat } from '../candidates';
import type { SeatingTable } from '../types';
import { nameList, WRAP } from './shared';
import type { SeatingHost } from './use-seating-host';

interface HouseholdProps {
  household: HouseholdToSeat;
  tables: readonly SeatingTable[];
  host: SeatingHost;
}

/** One household: its people coming here, the household as one, or one guest at a time. */
function HouseholdRow({ household, tables, host }: HouseholdProps) {
  const { t } = useTranslation('seating');
  const homes = tables.filter((table) => household.homeTableIds.includes(table.id));
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="m-0 text-base font-medium break-words">{household.name}</h3>
          <p className="text-muted-foreground m-0 text-sm">
            {t('toSeat.count', { count: household.guests.length })}
          </p>
          {homes.length > 0 ? (
            <p className="m-0 text-sm">
              {t('toSeat.sitsAt', { tables: nameList(homes.map((table) => table.name)) })}
            </p>
          ) : null}
        </div>
        {household.guests.length > 1 ? (
          <Button
            className={WRAP}
            aria-label={t('actionFor', { action: t('toSeat.seatHousehold'), name: household.name })}
            onClick={(event) =>
              host.open({ kind: 'seat', household, guests: household.guests }, event.currentTarget)
            }
          >
            {t('toSeat.seatHousehold')}
          </Button>
        ) : null}
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {household.guests.map((guest) => (
          <li
            key={guest.id}
            className="border-border flex items-center justify-between gap-3 border-t py-2 first:border-t-0"
          >
            <span className="min-w-0 break-words">{guest.name}</span>
            <Button
              variant="outline"
              aria-label={t('actionFor', { action: t('toSeat.seatGuest'), name: guest.name })}
              onClick={(event) =>
                host.open({ kind: 'seat', household, guests: [guest] }, event.currentTarget)
              }
            >
              {t('toSeat.seatGuest')}
            </Button>
          </li>
        ))}
      </ul>
    </li>
  );
}

interface ToSeatProps {
  households: Loaded<Household[]>;
  toSeat: readonly HouseholdToSeat[];
  tables: readonly SeatingTable[];
  host: SeatingHost;
  /** Whether anyone at all is coming here, seated or not. */
  isAnyoneComing: boolean;
}

/**
 * "Coming, not seated yet" (design PD-69): households in the guest list's order, each with only
 * its people coming here who have no seat in this plan, the same set automatic seating uses.
 */
export function ToSeat({ households, toSeat, tables, host, isAnyoneComing }: ToSeatProps) {
  const { t } = useTranslation('seating');
  const empty = isAnyoneComing ? t('toSeat.empty') : t('toSeat.nobodyComing');
  return (
    <section aria-labelledby="seating-to-seat" className="flex flex-col gap-3">
      <h2 id="seating-to-seat" className="m-0 text-lg font-medium">
        {t('toSeat.title')}
      </h2>
      {households.kind === 'ready' ? (
        <p className="text-muted-foreground m-0 text-sm">{t('toSeat.intro')}</p>
      ) : (
        <LoadedProblem loaded={households} refusedText={t('toSeat.refused')} />
      )}
      {households.kind === 'ready' && toSeat.length === 0 ? <p className="m-0">{empty}</p> : null}
      {toSeat.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {toSeat.map((household) => (
            <HouseholdRow key={household.id} household={household} tables={tables} host={host} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
