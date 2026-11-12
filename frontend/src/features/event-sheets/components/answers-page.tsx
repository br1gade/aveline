import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { browserSession } from '@/api/session';
import { sheetsPath } from '@/features/events';
import { useLanguageName } from '@/lib/i18n';
import { MoreButton, useMore } from '@/ui/app-form';

import { getAnswerPage, getQuestionPage } from '../api';
import type { AnswersData } from '../load';
import type { AnsweredQuestion, AnswersSheet, QuestionResponse } from '../types';

import { LINK, PartOf, Rows, Sheet, SheetHeader } from './parts';

function Responses({ responses }: { responses: readonly QuestionResponse[] }) {
  const { t } = useTranslation('sheets');
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {responses.map(({ id, name, household, status, display }) => (
        <li key={id} className="break-words">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground text-sm"> · {household} · </span>
          <span className="text-muted-foreground text-sm">
            {t(`answers.status.${status}`, { defaultValue: status })}
          </span>
          <span className="block whitespace-pre-line">{display}</span>
        </li>
      ))}
    </ul>
  );
}

/** Who answered, read on request a page at a time, in the language the questions came in (FR-117). */
function WhoAnswered({ eventId, question, locale }: QuestionProps) {
  const { t } = useTranslation('sheets');
  const responses = useMore(null, (offset) =>
    getAnswerPage(browserSession().api, { eventId, questionId: question.id }, { locale, offset }),
  );
  if (question.answered === 0) return null;
  return (
    <>
      {responses.items ? <Responses responses={responses.items} /> : null}
      {responses.hasMore ? (
        <MoreButton
          label={t(responses.items ? 'answers.more' : 'answers.who')}
          failed={t('answers.moreFailed')}
          isLoading={responses.state === 'loading'}
          hasFailed={responses.state === 'failed'}
          onPress={responses.more}
        />
      ) : null}
    </>
  );
}

interface QuestionProps {
  eventId: string;
  question: AnsweredQuestion;
  locale: string;
}

/**
 * A choice counted twice: among guests coming, what a caterer orders, and among everyone who
 * answered (docs/API.md §6), over every answer, however few are read. Who answered is read on request.
 */
function Question(props: QuestionProps) {
  const { t } = useTranslation('sheets');
  const { question, locale } = props;
  return (
    <Sheet
      title={question.prompt ?? t('answers.untitled')}
      note={t('answers.answered', { count: question.answered })}
      {...(question.prompt === null ? {} : { lang: locale })}
    >
      {question.tally ? (
        <Rows
          labelLang={locale}
          rows={question.tally.map(({ option, attending, total }) => ({
            label: option,
            value: t('answers.tally', { attending, total }),
          }))}
        />
      ) : null}
      <WhoAnswered {...props} />
    </Sheet>
  );
}

/** The event's languages, each a link in the address; the one the response names is current. */
function LanguageChoice({ locales, current }: { locales: readonly string[]; current: string }) {
  const { t } = useTranslation('sheets');
  const languageName = useLanguageName();
  if (locales.length < 2) return null;
  return (
    <nav aria-label={t('answers.language')} className="flex flex-wrap gap-x-4">
      {locales.map((locale) => (
        <Link
          key={locale}
          to={`?locale=${encodeURIComponent(locale)}`}
          className={LINK}
          aria-current={locale === current ? 'page' : undefined}
        >
          {languageName(locale)}
        </Link>
      ))}
    </nav>
  );
}

function Answers({
  eventId,
  sheet,
  asked,
}: {
  eventId: string;
  sheet: AnswersSheet;
  asked: string | null;
}) {
  const { t } = useTranslation('sheets');
  const languageName = useLanguageName();
  const questions = useMore(sheet, (offset) =>
    getQuestionPage(browserSession().api, eventId, { locale: sheet.locale, offset }),
  );
  if (sheet.items.length === 0) return <p className="m-0">{t('answers.none')}</p>;
  return (
    <>
      {asked && asked !== sheet.locale ? (
        <p className="m-0">
          {t('answers.otherLanguage', { language: languageName(sheet.locale) })}
        </p>
      ) : null}
      {(questions.items ?? []).map((question) => (
        <Question key={question.id} eventId={eventId} question={question} locale={sheet.locale} />
      ))}
      {questions.hasMore ? (
        <MoreButton
          label={t('answers.moreQuestions')}
          failed={t('answers.moreFailed')}
          isLoading={questions.state === 'loading'}
          hasFailed={questions.state === 'failed'}
          onPress={questions.more}
        />
      ) : null}
    </>
  );
}

/**
 * What guests answered to the host's own questions (docs/API.md §6; design PD-144), twenty questions at
 * a time (FR-117). The prompts are in the language the response names, never assumed to be the one
 * asked for.
 */
export function AnswersPage({ data }: { data: AnswersData }) {
  const { t } = useTranslation('sheets');
  return (
    <section className="flex flex-col gap-5">
      <SheetHeader
        back={t('answers.back')}
        backTo={sheetsPath(data.event.id)}
        title={t('answers.title')}
        subject={data.event.title}
      />
      <p className="m-0 max-w-[40rem]">{t('answers.lead')}</p>
      <PartOf read={data.answers} refused={t('refused')}>
        {(sheet) => (
          <>
            <LanguageChoice locales={data.event.locales} current={sheet.locale} />
            <Answers key={sheet.locale} eventId={data.event.id} sheet={sheet} asked={data.asked} />
          </>
        )}
      </PartOf>
    </section>
  );
}
