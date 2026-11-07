import { useTranslation } from 'react-i18next';

import type { Guest, Household } from '@/features/guests';
import { Icon } from '@/ui';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/kit/button';

import { arrivalOf } from '../arrival';
import { statementsStillOwed, statementWords } from '@/features/agreements';
import type { Door } from './use-door';
import { useEventTime, useSeatWords, WRAPPING } from './shared';

interface GuestRowProps {
  guest: Guest;
  household: Household;
  door: Door;
  timeZone: string;
  defaultLocale: string;
}

function Owed({ guest, door, defaultLocale }: Omit<GuestRowProps, 'household' | 'timeZone'>) {
  const { t, i18n } = useTranslation('door');
  const { read } = door.mustAgree;
  if (read.kind !== 'ready') return null;
  const owed = statementsStillOwed(guest.id, read.statements, read.agreements);
  if (owed.length === 0) return null;
  return (
    <p className="m-0 flex items-start gap-1.5 text-sm font-medium">
      <Icon name="circle-alert" size={16} className="mt-0.5 shrink-0" />
      <span>
        {t('row.mustAgree', {
          statements: owed
            .map((statement) => statementWords(statement, i18n.language, defaultLocale))
            .join('; '),
        })}
      </span>
    </p>
  );
}

/**
 * One person (design PD-90). Check in fills the row, for the thumb. Undo is small and on the far
 * side, so that a second tap on the same spot never undoes what the first one did.
 */
export function GuestRow({ guest, household, door, timeZone, defaultLocale }: GuestRowProps) {
  const { t } = useTranslation('door');
  const timeOf = useEventTime(timeZone);
  const seatWords = useSeatWords();
  const arrival = arrivalOf(guest, door.state);
  const isRunning = door.state.running === guest.id;
  const isBusy = door.state.running !== null;
  const facts = [
    household.name === guest.name ? '' : household.name,
    seatWords(guest.seats),
    t(`answer.${guest.answer}`),
  ].filter(Boolean);
  return (
    <li className="bg-card border-border flex flex-col gap-2 border p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-lg leading-snug font-medium break-words">{guest.name}</h2>
        <p className="text-muted-foreground m-0 text-sm break-words">{facts.join(' · ')}</p>
      </div>
      {arrival.isHere ? (
        <>
          <p className="m-0 flex items-start gap-1.5 text-sm font-medium">
            <Icon name="circle-check" size={16} className="mt-0.5 shrink-0" />
            <span>
              {arrival.at ? t('row.hereSince', { time: timeOf(arrival.at) }) : t('row.here')}
            </span>
          </p>
          <Button
            variant="outline"
            disabled={isBusy}
            aria-label={t('row.undoFor', { name: guest.name })}
            className={cn(WRAPPING, 'self-end')}
            onClick={() => void door.actions.undo(guest)}
          >
            {isRunning ? t('row.undoing') : t('row.undo')}
          </Button>
        </>
      ) : (
        <>
          <Owed guest={guest} door={door} defaultLocale={defaultLocale} />
          <Button
            disabled={isBusy}
            aria-label={t('row.checkInFor', { name: guest.name })}
            className={cn(WRAPPING, 'min-h-12 w-full pointer-coarse:min-h-12')}
            onClick={() => void door.actions.checkIn(guest)}
          >
            {isRunning ? t('row.checkingIn') : t('row.checkIn')}
          </Button>
        </>
      )}
    </li>
  );
}
