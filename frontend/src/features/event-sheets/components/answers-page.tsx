import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { sheetsPath } from '@/features/events';
import { useLanguageName } from '@/lib/i18n';

import type { AnswersData } from '../load';
import type { AnsweredQuestion, AnswersSheet, QuestionResponse } from '../types';

import { LINK, PartOf, Rows, Sheet, SheetHeader } from './parts';

function Responses({ responses }: { responses: readonly QuestionResponse[] }) {
  const { t } = useTranslation('sheets');
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {responses.map(({ guestId, name, household, status, display }) => (
        <li key={guestId} className="break-words">
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

/**
 * A choice counted twice: among guests coming, what a caterer orders, and among everyone who
 * answered (docs/API.md §6). Who chose what folds away under it; free text has only that list.
 */
function Question({ question, locale }: { question: AnsweredQuestion; locale: string }) {
  const { t } = useTranslation('sheets');
  const { tally, responses } = question;
  return (
    <Sheet
      title={question.prompt ?? t('answers.untitled')}
      note={t('answers.answered', { count: question.answered })}
      {...(question.prompt === null ? {} : { lang: locale })}
    >
      {tally ? (
        <Rows
          labelLang={locale}
          rows={tally.map(({ option, attending, total }) => ({
            label: option,
            value: t('answers.tally', { attending, total }),
          }))}
        />
      ) : (
        <Responses responses={responses} />
      )}
      {tally && responses.length > 0 ? (
        <details>
          <summary className="min-h-11 cursor-pointer py-2">{t('answers.who')}</summary>
          <Responses responses={responses} />
        </details>
      ) : null}
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

function Answers({ sheet, asked }: { sheet: AnswersSheet; asked: string | null }) {
  const { t } = useTranslation('sheets');
  const languageName = useLanguageName();
  if (sheet.questions.length === 0) return <p className="m-0">{t('answers.none')}</p>;
  return (
    <>
      {asked && asked !== sheet.locale ? (
        <p className="m-0">
          {t('answers.otherLanguage', { language: languageName(sheet.locale) })}
        </p>
      ) : null}
      {sheet.questions.map((question) => (
        <Question key={question.id} question={question} locale={sheet.locale} />
      ))}
    </>
  );
}

/**
 * What guests answered to the host's own questions (docs/API.md §6; design PD-144). The prompts are
 * in the language the response names, never assumed to be the one asked for.
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
            <Answers sheet={sheet} asked={data.asked} />
          </>
        )}
      </PartOf>
    </section>
  );
}
