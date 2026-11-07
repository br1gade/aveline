import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Household } from '@/features/guests';
import { Button } from '@/ui/kit/button';

import { isActive, isResultStale, jobPhase } from '../jobs';
import type { Arrangement, SeatingJob } from '../types';
import { JobFailure, JobResultView } from './job-result';
import { PANEL, SeatingProblem, useEventMoment, WRAP } from './shared';
import { useAutoSeating } from './use-auto-seating';
import type { SeatingHost } from './use-seating-host';

/** The worker's attempts in all (`SEATING_ATTEMPTS`), crash recovery included. */
const ATTEMPTS = 3;

type Auto = ReturnType<typeof useAutoSeating>;

/** Where a run stands, as the status line says it; nothing once it ended. */
function useProgress(job: SeatingJob | null, isTimedOut: boolean): string {
  const { t } = useTranslation('seating');
  if (!job || !isActive(job)) return '';
  if (isTimedOut) return t('auto.progress.timedOut');
  const phase = jobPhase(job);
  if (phase === 'planning') {
    return t('auto.progress.planning', { attempt: job.attempts, total: ATTEMPTS });
  }
  if (phase === 'retrying') {
    return t('auto.progress.retrying', { attempt: job.attempts + 1, total: ATTEMPTS });
  }
  return t('auto.progress.waiting');
}

interface AutoSeatingProps {
  plan: Arrangement;
  latest: SeatingJob | undefined;
  tableCount: number;
  /** People coming and not seated here; `null` when the guest list could not be read. */
  toSeat: number | null;
  /** Whether anyone at all is coming here, seated or not. */
  isAnyoneComing: boolean;
  households: readonly Household[];
  timeZone: string;
  host: SeatingHost;
}

/** Why the button cannot be pressed now, said beside it (DESIGN_SYSTEM §10); `''` when it can. */
function useBlocked({ tableCount, toSeat, isAnyoneComing }: AutoSeatingProps): string {
  const { t } = useTranslation('seating');
  if (tableCount === 0) return t('auto.noTables');
  if (toSeat !== 0) return '';
  return isAnyoneComing ? t('auto.nobody') : t('toSeat.nobodyComing');
}

function StartRow({ auto, blocked }: { auto: Auto; blocked: string }) {
  const { t } = useTranslation('seating');
  const isRunning = auto.job !== null && isActive(auto.job);
  const label = auto.job?.status === 'FAILED' ? t('auto.again') : t('auto.start');
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button
        className={`self-start ${WRAP}`}
        disabled={blocked !== '' || isRunning || auto.isStarting}
        onClick={() => void auto.start()}
      >
        {auto.isStarting ? t('auto.starting') : label}
      </Button>
      {blocked ? <p className="text-muted-foreground m-0 text-sm">{blocked}</p> : null}
    </div>
  );
}

interface OutcomeProps {
  auto: Auto;
  plan: Arrangement;
  households: readonly Household[];
  host: SeatingHost;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/** What the run did, or why it stopped. */
function Outcome({ auto, plan, households, host, headingRef }: OutcomeProps) {
  const { job } = auto;
  if (job?.status === 'FAILED') return <JobFailure job={job} headingRef={headingRef} />;
  if (job?.status !== 'COMPLETED' || !job.result) return null;
  return (
    <JobResultView
      result={job.result}
      households={households}
      isStale={isResultStale(job, plan)}
      host={host}
      headingRef={headingRef}
    />
  );
}

function CheckAgain({ onCheck }: { onCheck: () => void }) {
  const { t } = useTranslation('seating');
  return (
    <Button variant="outline" className="self-start" onClick={onCheck}>
      {t('auto.check')}
    </Button>
  );
}

/** When the run on screen ended, in the event's zone; nothing while it runs. */
function LastRun({ job, timeZone }: { job: SeatingJob | null; timeZone: string }) {
  const { t } = useTranslation('seating');
  const moment = useEventMoment(timeZone);
  if (!job || isActive(job)) return null;
  const when = moment(job.completedAt ?? job.createdAt);
  return <p className="text-muted-foreground m-0 text-sm">{t('auto.last', { when })}</p>;
}

/**
 * Automatic seating for one plan (design PD-70): what it does, the press, where the run stands,
 * and what it did or why it stopped. The page gives each plan its own, keyed by the plan.
 */
export function AutoSeating(props: AutoSeatingProps) {
  const { plan, latest, households, timeZone, host } = props;
  const { t } = useTranslation('seating');
  const auto = useAutoSeating({
    eventId: host.eventId,
    arrangementId: plan.id,
    latest,
    reload: host.reload,
  });
  const { job, isTimedOut } = auto;
  const isRunning = job !== null && isActive(job);
  const progress = useProgress(job, isTimedOut);
  const blocked = useBlocked(props);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (auto.hasFinishedHere) headingRef.current?.focus();
  }, [auto.hasFinishedHere, job?.status]);
  return (
    <section aria-labelledby="seating-auto" className={PANEL}>
      <h2 id="seating-auto" className="m-0 text-lg font-medium">
        {t('auto.title')}
      </h2>
      <p className="m-0 text-sm">{t('auto.explain')}</p>
      {auto.refusal ? <SeatingProblem refusal={auto.refusal} /> : null}
      <StartRow auto={auto} blocked={isRunning ? '' : blocked} />
      <p role="status" className="m-0 text-sm font-medium">
        {progress}
      </p>
      {isTimedOut && isRunning ? <CheckAgain onCheck={auto.checkAgain} /> : null}
      <Outcome
        auto={auto}
        plan={plan}
        households={households}
        host={host}
        headingRef={headingRef}
      />
      <LastRun job={job} timeZone={timeZone} />
    </section>
  );
}
