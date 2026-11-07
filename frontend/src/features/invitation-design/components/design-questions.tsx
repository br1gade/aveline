import { useTranslation } from 'react-i18next';

import { StatusLine, usePageStatus } from '@/ui/app-form';

import type { DesignData } from '../load';
import type { Design } from '../types';
import { BuiltInQuestions } from './built-in-questions';
import { DesignHeader, NoInvitation } from './design-parts';
import { QuestionList } from './question-list';

const SECTION_TITLE = 'm-0 text-lg font-medium';

function Questions({ data, design }: { data: DesignData; design: Design }) {
  const { t } = useTranslation('design');
  const { page, status, statusRef } = usePageStatus(data);
  return (
    <section className="flex flex-col gap-6">
      <DesignHeader
        eventId={design.event.id}
        back="design"
        title={t('questions.title')}
        subtitle={data.event.title}
      >
        <p className="m-0 max-w-[40rem]">{t('questions.lead')}</p>
      </DesignHeader>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <section aria-labelledby="questions-built-in" className="flex flex-col gap-3">
        <h2 id="questions-built-in" className={SECTION_TITLE}>
          {t('questions.builtInTitle')}
        </h2>
        {/* Once saved, the form starts again from what the server stored, keys included. */}
        <BuiltInQuestions key={JSON.stringify(design.rsvpFields)} design={design} page={page} />
      </section>
      <section aria-labelledby="questions-own" className="flex flex-col gap-3">
        <h2 id="questions-own" className={SECTION_TITLE}>
          {t('questions.ownTitle')}
        </h2>
        <p className="text-muted-foreground m-0 text-sm">{t('questions.ownLead')}</p>
        <QuestionList design={design} page={page} />
      </section>
    </section>
  );
}

/**
 * What the reply form asks (design PD-60, PD-61): the built-in questions, and the host's own in
 * their order.
 */
export function DesignQuestions({ data }: { data: DesignData }) {
  if (!data.design) return <NoInvitation eventId={data.event.id} title={data.event.title} />;
  return <Questions data={data} design={data.design} />;
}
