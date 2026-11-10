import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { guestListPath } from '@/features/events';
import type { Guest } from '@/features/guests';
import { Icon, type IconName } from '@/ui';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/kit/button';

import type { DoorResult } from '../arrival';
import { statementWords } from '@/features/agreements';
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
  if (result.kind === 'addedNotHere') return 'problem';
  if (result.kind !== 'refused') return 'calm';
  return CALM_REFUSALS.has(result.refusal.kind) ? 'calm' : 'problem';
}

function nameOf(result: DoorResult): string | null {
  return 'name' in result ? result.name || null : null;
}

export function useRefusalWords() {
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

/** A statement's words in the page's language, else the event's, else whichever came. */
function labelIn(labels: Readonly<Record<string, string>>, language: string, fallback: string) {
  return labels[language] ?? labels[fallback] ?? Object.values(labels)[0] ?? null;
}

/**
 * The statements this person still owes (FR-76): worded by the refusal itself, or, from older
 * words naming one by its id, by the design when it has been read.
 */
function RefusedStatement({ refusal, door, defaultLocale }: StatementProps) {
  const { i18n } = useTranslation('door');
  if (refusal.kind !== 'mustAgree') return null;
  const { read } = door.mustAgree;
  const statements = read.kind === 'nothing' ? null : read.statements;
  const fromDesign = (questionId: string) => {
    const statement = statements?.find((each) => each.questionId === questionId);
    return statement ? statementWords(statement, i18n.language, defaultLocale) : null;
  };
  const owed = refusal.missing ?? [{ questionId: refusal.questionId, labels: {} }];
  const words = owed.flatMap(({ questionId, labels }) => {
    const text = labelIn(labels, i18n.language, defaultLocale) ?? fromDesign(questionId);
    return text ? [{ questionId, text }] : [];
  });
  return words.map(({ questionId, text }) => (
    <p key={questionId} className="m-0 font-medium break-words">
      {text}
    </p>
  ));
}

function useResultWords(timeZone: string) {
  const { t } = useTranslation('door');
  const timeOf = useEventTime(timeZone);
  const seatWords = useSeatWords();
  const refusalWords = useRefusalWords();
  const earlier = (isOurs: boolean) => (isOurs ? t('result.earlierPress') : null);
  const usedWords = (usedAt: string | undefined) =>
    usedAt ? t('result.ticketUsedAt', { time: timeOf(usedAt) }) : t('result.ticketUsed');
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
        return [usedWords(result.usedAt), earlier(result.isOurEarlierPress)];
      case 'undone':
        return [t('result.undone')];
      case 'addedNotHere':
        return [t('result.addedNotHere'), refusalWords(result.refusal)];
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

/** Checking in again, where it can help: the agreement now given, or a walk-in now on the list. */
function TryAgain({ result, door, eventId, guest }: ActionsProps & { guest: Guest }) {
  const { t } = useTranslation('door');
  const isToAgree = result.kind === 'refused' && result.refusal.kind === 'mustAgree';
  if (!isToAgree && result.kind !== 'addedNotHere') return null;
  return (
    <>
      <Button
        variant="outline"
        disabled={door.state.running !== null}
        className={WRAPPING}
        onClick={() => void door.actions.checkIn(guest)}
      >
        {t('result.tryAgain')}
      </Button>
      {isToAgree ? (
        <Link
          to={`${guestListPath(eventId)}?${new URLSearchParams({ q: guest.name }).toString()}`}
          className={LINK}
        >
          {t('result.sendAgain')}
        </Link>
      ) : null}
    </>
  );
}

function ResultActions({ result, door, eventId }: ActionsProps) {
  const { t } = useTranslation('door');
  const guestId = 'guestId' in result ? (result.guestId ?? null) : null;
  const guest = guestId === null ? undefined : door.guests.byId.get(guestId);
  const isHere =
    result.kind === 'arrived' || result.kind === 'alreadyHere' || result.kind === 'ticketUsed';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {isHere && guest ? (
        <Button
          variant="outline"
          disabled={door.state.running !== null}
          className={WRAPPING}
          onClick={() => void door.actions.undo(guest)}
        >
          {t('result.undo')}
        </Button>
      ) : null}
      {guest ? <TryAgain result={result} door={door} eventId={eventId} guest={guest} /> : null}
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
