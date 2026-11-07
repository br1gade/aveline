import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { listGuests } from '@/features/guests';
import type { Question } from '@/features/invitation-design';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { readAllAgreements } from '../api';
import {
  agreementsFrom,
  owedByStatement,
  peopleWhoMustAgree,
  requiredStatements,
  statementWords,
  type StillOwed,
} from '../must-agree';

const READ_TIME_MS = 15_000;

type Read =
  | { kind: 'idle' | 'reading' | 'refused' | 'failed' }
  | { kind: 'ready'; owed: StillOwed[]; isComplete: boolean };

async function readWhoOwes(event: EventDetail, questions: readonly Question[]): Promise<Read> {
  const { api } = browserSession();
  const statements = requiredStatements(questions);
  const [households, agreed] = await Promise.all([
    listGuests(api, event.id, AbortSignal.timeout(READ_TIME_MS)),
    readAllAgreements(api, event.id, () => AbortSignal.timeout(READ_TIME_MS)),
  ]);
  const people = peopleWhoMustAgree(
    households,
    statements,
    agreementsFrom(agreed.items),
    (guest) => guest.isCheckedIn,
  );
  return {
    kind: 'ready',
    owed: owedByStatement(statements, people),
    isComplete: agreed.isComplete,
  };
}

function Owed({
  owed,
  language,
  fallback,
}: {
  owed: StillOwed;
  language: string;
  fallback: string;
}) {
  const { t } = useTranslation('agreements');
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-base font-medium break-words">
        {statementWords(owed.statement, language, fallback) ?? t('stillToAgree.untitled')}
      </h3>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
        {owed.names.map((name, position) => (
          <li key={`${position}-${name}`} className="break-words">
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadOutcome({
  read,
  language,
  fallback,
}: {
  read: Read;
  language: string;
  fallback: string;
}) {
  const { t } = useTranslation('agreements');
  if (read.kind === 'idle') return null;
  if (read.kind === 'reading') {
    return (
      <p role="status" className="m-0">
        {t('stillToAgree.reading')}
      </p>
    );
  }
  if (read.kind !== 'ready') {
    return (
      <p role="alert" className={read.kind === 'failed' ? 'text-destructive m-0' : 'm-0'}>
        {t(read.kind === 'failed' ? 'stillToAgree.failed' : 'refused')}
      </p>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-3">
      {read.owed.length === 0 && read.isComplete ? (
        <p className="m-0">{t('stillToAgree.none')}</p>
      ) : null}
      {read.owed.map((owed) => (
        <Owed key={owed.statement.versionId} owed={owed} language={language} fallback={fallback} />
      ))}
      {read.isComplete ? null : <p className="m-0 text-sm">{t('stillToAgree.partial')}</p>}
    </div>
  );
}

/**
 * Those coming who have not agreed to a required statement's current wording (design PD-155), worked
 * out as the door's list is, because no read says it (FR-78). Read only when asked: it can take
 * twenty pages of a rate-limited read. It is advice, and the door decides on the day.
 */
export function StillToAgree({
  event,
  questions,
}: {
  event: EventDetail;
  questions: readonly Question[] | null;
}) {
  const { t, i18n } = useTranslation('agreements');
  const [read, setRead] = useState<Read>({ kind: 'idle' });
  if (!questions || requiredStatements(questions).length === 0) return null;
  const load = async () => {
    setRead({ kind: 'reading' });
    try {
      setRead(await readWhoOwes(event, questions));
    } catch (error) {
      setRead({ kind: isApiError(error) && error.status === 403 ? 'refused' : 'failed' });
      // Anything that isn't the API's is a bug, and goes on as one, with the button free again.
      if (!isApiError(error)) throw error;
    }
  };
  return (
    <section aria-labelledby="still-to-agree" className="flex flex-col gap-3">
      <h2 id="still-to-agree" className="m-0 text-xl font-medium">
        {t('stillToAgree.title')}
      </h2>
      <p className="m-0">{t('stillToAgree.lead')}</p>
      <ReadOutcome read={read} language={i18n.language} fallback={event.defaultLocale} />
      {read.kind === 'ready' || read.kind === 'refused' ? null : (
        <Button
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          disabled={read.kind === 'reading'}
          onClick={() => void load()}
        >
          {t(read.kind === 'failed' ? 'stillToAgree.tryAgain' : 'stillToAgree.show')}
        </Button>
      )}
    </section>
  );
}
