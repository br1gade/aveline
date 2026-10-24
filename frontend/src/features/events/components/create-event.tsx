import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { browserSession } from '@/api/session';
import { AccountForm, ProblemAlert, SubmitButton, type Problem } from '@/features/account';
import { timeZoneOptions } from '@/lib/time';

import { createEvent } from '../api';
import { DEFAULT_TIME_ZONE, languageOptions, NEW_EVENT_VALUES } from '../form-model';
import { eventPath } from '../paths';
import { createPayload } from '../payload';
import { markRefusals, useRefusedText } from '../refusals';
import { eventFormSchema, type EventFormInput, type EventFormValues } from '../schemas';
import { EventFields } from './event-fields';

const schema = eventFormSchema('create');

/**
 * Creates the event and its draft invitation (docs/API.md §6, "Creating an event"). The slug is
 * generated, never asked for. The page replaces itself with the new event, so Back cannot send
 * the form a second time.
 */
export function CreateEvent() {
  const { t } = useTranslation('events');
  const navigate = useNavigate();
  const refused = useRefusedText('create');
  const [problem, setProblem] = useState<Problem | null>(null);
  const zones = useMemo(() => timeZoneOptions(DEFAULT_TIME_ZONE), []);
  const form = useForm<EventFormInput, unknown, EventFormValues>({
    resolver: zodResolver(schema),
    defaultValues: NEW_EVENT_VALUES,
  });
  const { isSubmitting } = form.formState;

  const onSubmit = async (values: EventFormValues) => {
    setProblem(null);
    try {
      const event = await createEvent(browserSession().api, createPayload(values));
      await navigate(eventPath(event.id), { replace: true });
    } catch (error) {
      setProblem(markRefusals(error, form.setError));
    }
  };

  return (
    <section className="flex max-w-[30rem] flex-col gap-5">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('create.title')}</h1>
      <p className="text-muted-foreground m-0">{t('create.lead')}</p>
      {problem ? <ProblemAlert problem={problem} refused={refused} /> : null}
      <AccountForm onSubmit={form.handleSubmit(onSubmit)} className="gap-5">
        <EventFields form={form} mode="create" zones={zones} languages={languageOptions()} />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting ? t('create.submitting') : t('create.submit')}
        </SubmitButton>
      </AccountForm>
    </section>
  );
}
