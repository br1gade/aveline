import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { guestListPath } from '@/features/events';
import { Icon, type IconName } from '@/ui';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/kit/button';

import type { DoorResult } from '../arrival';
import { statementWords } from '../must-agree';
import type { DoorRefusal } from '../refusals';
import type { Door } from './use-door';
import { LINK, useEventTime, useSeatWords, WRAPPING } from './shared';

type Tone = 'good' | 'calm' | 'problem';

const ICONS: Record<Tone, IconName> = {
  good: 'circle-check',
  calm: 'info',
  problem: 'circle-alert',
};

const CALM_REFUSALS: ReadonlySet<DoorRefusal['kind']> = new Set(['linkChanged', 'rateLimited']);

function toneOf(result: DoorResult): Tone {
  if (result.kind === 'arrived') return result.wasExpected ? 'good' : 'calm';
  if (result.kind === 'admittedUnlinked') return 'good';
  if (result.kind !== 'refused') return 'calm';
  return CALM_REFUSALS.has(result.refusal.kind) ? 'calm' : 'problem';
}

function nameOf(result: DoorResult): string | null {
  return result.kind === 'ticketUsed' ? null : result.name || null;
}

function useRefusalWords() {
  const { t } = useTranslation('door');
  return (refusal: DoorRefusal): ReactNode => {
    // Each of these has its own outcome, and is never shown as a refusal.
    if (
      refusal.kind === 'alreadyHere' ||
      refusal.kind === 'ticketUsed' ||
      refusal.kind === 'notCheckedIn'
    )
      return null;
    if (refusal.kind === 'other') {
      return (
        <>
          {t('refused.other')} <span lang="en">{refusal.sentence}</span>
        </>
      );
    }
    return t(`refused.${refusal.kind}`);
  };
}

function Reference({ refusal }: { refusal: DoorRefusal }) {
  const { t } = useTranslation('door');
  const requestId = 'requestId' in refusal ? refusal.requestId : undefined;
  return requestId ? <p className="m-0 text-sm">{t('refused.reference', { requestId })}</p> : null;
}

interface StatementProps {
  refusal: DoorRefusal;
  door: Door;
  defaultLocale: string;
}

/** The refused statement's words, when the design has been read. */
function RefusedStatement({ refusal, door, defaultLocale }: StatementProps) {
  const { i18n } = useTranslation('door');
  const { read } = door.mustAgree;
  if (refusal.kind !== 'mustAgree' || read.kind === 'nothing') return null;
  const statement = read.statements?.find(({ questionId }) => questionId === refusal.questionId);
  const words = statement ? statementWords(statement, i18n.language, defaultLocale) : null;
  return words ? <p className="m-0 font-medium break-words">{words}</p> : null;
}

function useResultWords(timeZone: string) {
  const { t } = useTranslation('door');
  const timeOf = useEventTime(timeZone);
  const seatWords = useSeatWords();
  const refusalWords = useRefusalWords();
  const earlier = (isOurs: boolean) => (isOurs ? t('result.earlierPress') : null);
  return (result: DoorResult): ReactNode[] => {
    switch (result.kind) {
      case 'arrived':
        return [
          t('result.arrived', { time: timeOf(result.arrivedAt) }),
          seatWords(result.seats) || null,
          result.wasExpected ? null : t('result.notExpected'),
        ];
      case 'admittedUnlinked':
        return [t('result.unlinked', { time: timeOf(result.arrivedAt) })];
      case 'alreadyHere':
        return [
          result.arrivedAt
            ? t('result.alreadyHere', { time: timeOf(result.arrivedAt) })
            : t('result.alreadyHereNoTime'),
          earlier(result.isOurEarlierPress),
        ];
      case 'ticketUsed':
        return [t('result.ticketUsed'), earlier(result.isOurEarlierPress)];
      case 'undone':
        return [t('result.undone')];
      default:
        return [refusalWords(result.refusal)];
    }
  };
}

interface ActionsProps {
  result: DoorResult;
  door: Door;
  eventId: string;
}

function ResultActions({ result, door, eventId }: ActionsProps) {
  const { t } = useTranslation('door');
  const isBusy = door.state.running !== null;
  const guestId = 'guestId' in result ? result.guestId : null;
  const guest = guestId === null ? undefined : door.guests.byId.get(guestId);
  const isHere = result.kind === 'arrived' || result.kind === 'alreadyHere';
  const isToAgree = result.kind === 'refused' && result.refusal.kind === 'mustAgree';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {isHere && guest ? (
        <Button
          variant="outline"
          disabled={isBusy}
          className={WRAPPING}
          onClick={() => void door.actions.undo(guest)}
        >
          {t('result.undo')}
        </Button>
      ) : null}
      {isToAgree && guest ? (
        <>
          <Button
            variant="outline"
            disabled={isBusy}
            className={WRAPPING}
            onClick={() => void door.actions.checkIn(guest)}
          >
            {t('result.tryAgain')}
          </Button>
          <Link
            to={`${guestListPath(eventId)}?${new URLSearchParams({ q: guest.name }).toString()}`}
            className={LINK}
          >
            {t('result.sendAgain')}
          </Link>
        </>
      ) : null}
      <Button variant="ghost" className={cn(WRAPPING, 'ml-auto')} onClick={door.actions.dismiss}>
        {t('result.dismiss')}
      </Button>
    </div>
  );
}

interface DoorResultLineProps {
  door: Door;
  eventId: string;
  timeZone: string;
  defaultLocale: string;
}

/**
 * The last outcome, with an icon and words, kept at the bottom of the screen: under the thumb, in
 * view wherever the list is scrolled, with Undo on it. Each new one takes the focus without moving
 * the page, which closes the phone's keyboard so it can be read. The region is always there, empty
 * when idle, so a screen reader announces it when it fills.
 */
export function DoorResultLine({ door, eventId, timeZone, defaultLocale }: DoorResultLineProps) {
  const { result } = door.state;
  const wordsOf = useResultWords(timeZone);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result) ref.current?.focus({ preventScroll: true });
  }, [result]);
  const tone = result ? toneOf(result) : null;
  const name = result ? nameOf(result) : null;
  return (
    <div ref={ref} role="status" tabIndex={-1} className="sticky bottom-0 z-10 outline-none">
      {result && tone ? (
        <div
          className={cn(
            'bg-card flex max-h-[50vh] flex-col gap-2 overflow-y-auto border-2 p-4 shadow-md',
            tone === 'problem' ? 'border-destructive' : 'border-border',
          )}
        >
          <div className="flex items-start gap-2">
            <Icon
              name={ICONS[tone]}
              size={20}
              className={cn('mt-0.5 shrink-0', tone === 'problem' && 'text-destructive')}
            />
            <div className="flex min-w-0 flex-col gap-1">
              {name ? (
                <p className="m-0 text-lg leading-snug font-medium break-words">{name}</p>
              ) : null}
              {wordsOf(result)
                .filter(Boolean)
                .map((words, at) => (
                  <p key={at} className="m-0 break-words">
                    {words}
                  </p>
                ))}
              {result.kind === 'refused' ? (
                <>
                  <RefusedStatement
                    refusal={result.refusal}
                    door={door}
                    defaultLocale={defaultLocale}
                  />
                  <Reference refusal={result.refusal} />
                </>
              ) : null}
            </div>
          </div>
          <ResultActions result={result} door={door} eventId={eventId} />
        </div>
      ) : null}
    </div>
  );
}
