import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { eventPath } from '@/features/events';
import type { Question } from '@/features/invitation-design';
import { LoadedProblem } from '@/features/sending';
import { Button } from '@/ui/kit/button';

import { listAgreements } from '../api';
import { groupAgreements, type StatementInfo } from '../group';
import type { AgreementsData } from '../load';
import type { AgreementsPage as RecordsPage } from '../types';
import { StatementBlock } from './statement-group';
import { StillToAgree } from './still-to-agree';

const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';
/** The kit's buttons never wrap; a long label in Armenian or Russian must, at 360 px. */
const WRAPPING =
  'h-auto min-h-10 py-2 text-left whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11';

/** The statement's words in the page's language, then the event's, then any. */
function statementsIn(
  questions: readonly Question[] | null,
  languages: readonly string[],
): StatementInfo[] | null {
  if (!questions) return null;
  return questions.map((question) => {
    const found = languages.map((language) => question.prompt[language]).find(Boolean);
    return {
      questionId: question.id,
      currentVersionId: question.statementVersionId,
      prompt: found ?? Object.values(question.prompt)[0] ?? null,
    };
  });
}

type OlderState = 'idle' | 'loading' | 'restarted' | Problem;

/**
 * Older pages, read one at a time and added below. A cursor names the last record read; one erased
 * meanwhile answers 404, and the list starts again from the newest, saying so.
 */
function useOlder(eventId: string, first: RecordsPage) {
  const [pages, setPages] = useState<RecordsPage[]>([first]);
  const [state, setState] = useState<OlderState>('idle');
  const nextCursor = pages.at(-1)?.nextCursor ?? null;
  const read = (after?: string) => listAgreements(browserSession().api, eventId, after);
  const restart = async () => {
    try {
      setPages([await read()]);
      setState('restarted');
    } catch (error) {
      setState(problemFrom(error));
    }
  };
  const loadOlder = async () => {
    if (!nextCursor) return;
    setState('loading');
    try {
      const page = await read(nextCursor);
      setPages((held) => [...held, page]);
      setState('idle');
    } catch (error) {
      if (!isApiError(error) || error.status !== 404) return setState(problemFrom(error));
      await restart();
    }
  };
  return { records: pages.flatMap((page) => page.records), nextCursor, state, loadOlder };
}

function Agreements({ data, first }: { data: AgreementsData; first: RecordsPage }) {
  const { t, i18n } = useTranslation('agreements');
  const { event } = data;
  const older = useOlder(event.id, first);
  const statements = statementsIn(data.statements, [i18n.language, event.defaultLocale]);
  const groups = groupAgreements(older.records, statements, data.names);
  const zone = { timeZone: event.timezone, locale: i18n.language };
  if (groups.length === 0) return <p className="m-0">{t('none')}</p>;
  return (
    <>
      {older.nextCursor ? (
        <p className="text-muted-foreground m-0 text-sm">
          {t('partial', { count: older.records.length })}
        </p>
      ) : null}
      {groups.map((group) => (
        <StatementBlock key={group.questionId} group={group} eventId={event.id} zone={zone} />
      ))}
      {older.nextCursor ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="outline"
            className={WRAPPING}
            disabled={older.state === 'loading'}
            onClick={() => void older.loadOlder()}
          >
            {older.state === 'loading' ? t('loadingOlder') : t('older')}
          </Button>
          {typeof older.state === 'object' ? (
            <p role="alert" className="text-destructive m-0 text-sm">
              {t('olderFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
      {older.state === 'restarted' ? (
        <p role="status" className="m-0 text-sm">
          {t('olderRestarted')}
        </p>
      ) : null}
    </>
  );
}

/**
 * Who agreed to the hosts' statements (docs/API.md §11; design PD-66), read-only: per statement and
 * wording, each guest, who agreed for them, how, and when, with a drawn signature on request. A role
 * without `guest:contact:read` is told so.
 */
export function AgreementsPage({ data }: { data: AgreementsData }) {
  const { t } = useTranslation('agreements');
  const { event, records } = data;
  return (
    <section className="flex max-w-[48rem] flex-col gap-6">
      <Link to={eventPath(event.id)} className={LINK}>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0 break-words">{event.title}</p>
      </div>
      <p className="m-0">{t('intro')}</p>
      {records.kind === 'ready' ? (
        <>
          <StillToAgree event={event} questions={data.statements} />
          <Agreements data={data} first={records.value} />
        </>
      ) : (
        <LoadedProblem loaded={records} refusedText={t('refused')} />
      )}
    </section>
  );
}
