import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { DesignData, DesignQuestionData } from '../load';
import { designQuestionsPath } from '../paths';
import { DesignHeader, NoInvitation, TEXT_LINK } from './design-parts';
import { QuestionFormView } from './question-form';

/** Adding a question of the host's own (design PD-61). */
export function NewDesignQuestion({ data }: { data: DesignData }) {
  const { t } = useTranslation('design');
  const { design } = data;
  if (!design) return <NoInvitation eventId={data.event.id} title={data.event.title} />;
  return (
    <section className="flex flex-col gap-5">
      <DesignHeader
        eventId={design.event.id}
        back="questions"
        title={t('question.newTitle')}
        subtitle={data.event.title}
      />
      <QuestionFormView design={design} question={null} />
    </section>
  );
}

/** Correcting one; a question removed meanwhile says so rather than failing the page. */
export function EditDesignQuestion({ data }: { data: DesignQuestionData }) {
  const { t } = useTranslation('design');
  const { design, question } = data;
  if (!design) return <NoInvitation eventId={data.event.id} title={data.event.title} />;
  return (
    <section className="flex flex-col gap-5">
      <DesignHeader
        eventId={design.event.id}
        back="questions"
        title={t('question.editTitle')}
        subtitle={data.event.title}
      />
      {question ? (
        <QuestionFormView design={design} question={question} />
      ) : (
        <>
          <p className="m-0">{t('question.gone')}</p>
          <Link to={designQuestionsPath(design.event.id)} className={TEXT_LINK}>
            {t('question.cancel')}
          </Link>
        </>
      )}
    </section>
  );
}
