import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Household } from '@/features/guests';
import { Button } from '@/ui/kit/button';

import { failureKey, unseatedKey } from '../jobs';
import type { JobResult, SeatingJob, UnseatedHousehold } from '../types';
import type { SeatingHost } from './use-seating-host';

/** Our words for the code, else the backend's sentence, else the planner's own in English. */
function Reason({ household }: { household: UnseatedHousehold }) {
  const { t } = useTranslation('seating');
  const key = unseatedKey(household.code);
  if (key) return <span>{t(`auto.reasons.${key}`, { count: household.size })}</span>;
  if (household.message) return <span>{household.message}</span>;
  return <span lang="en">{household.reason}</span>;
}

type HeadingRef = RefObject<HTMLHeadingElement | null>;

interface ResultProps {
  result: JobResult;
  /** The guest list's households, which name the ones the run could not seat (FR-55). */
  households: readonly Household[];
  isStale: boolean;
  host: SeatingHost;
  /** Takes the focus when a run started on this page ends. */
  headingRef: HeadingRef;
}

/**
 * What a completed run did (design PD-70): how many it seated, and the households that still need
 * a table, named from the guest list, each with its reason. Not a failure: a room nearly full
 * leaves some (docs/API.md §6).
 */
export function JobResultView({ result, households, isStale, host, headingRef }: ResultProps) {
  const { t } = useTranslation('seating');
  const nameOf = (id: string) =>
    households.find((household) => household.id === id)?.name ?? t('auto.result.unknownHousehold');
  const seatedLine = t('auto.result.seated', {
    count: result.seated,
    households: t('auto.result.households', { count: result.households }),
  });
  return (
    <div className="flex flex-col gap-2">
      <h3 ref={headingRef} tabIndex={-1} className="m-0 text-base font-medium outline-none">
        {t('auto.result.title')}
      </h3>
      <p className="m-0">{result.seated > 0 ? seatedLine : t('auto.result.nobody')}</p>
      {isStale ? (
        <p className="text-muted-foreground m-0 text-sm">{t('auto.result.stale')}</p>
      ) : null}
      {result.unseated.length > 0 ? (
        <>
          <p className="m-0 font-medium">
            {t('auto.result.needTable', { count: result.unseated.length })}
          </p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {result.unseated.map((household) => (
              <li key={household.householdId}>
                {nameOf(household.householdId)} ({t('auto.result.size', { count: household.size })}
                ): <Reason household={household} />
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="self-start"
            onClick={(event) => host.open({ kind: 'addTable' }, event.currentTarget)}
          >
            {t('auto.result.addTable')}
          </Button>
        </>
      ) : null}
    </div>
  );
}

/** Why a run ended without seating anyone, in our words where its code is known. */
export function JobFailure({ job, headingRef }: { job: SeatingJob; headingRef: HeadingRef }) {
  const { t } = useTranslation('seating');
  const key = failureKey(job.failureReason);
  const text = key ? t(`auto.failures.${key}`) : (job.recoveryMessage ?? t('auto.failures.failed'));
  return (
    <div className="flex flex-col gap-1">
      <h3 ref={headingRef} tabIndex={-1} className="m-0 text-base font-medium outline-none">
        {t('auto.failures.title')}
      </h3>
      <p className="m-0">{text}</p>
    </div>
  );
}
