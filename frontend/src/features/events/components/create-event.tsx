import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { ApiClient } from '@/api/client';
import { type Problem } from '@/api/problems';
import type { components } from '@/api/schema';
import { browserSession } from '@/api/session';
import { DEFAULT_TIME_ZONE, timeZoneOptions } from '@/lib/time';
import { AppForm, ProblemAlert, SubmitButton, useLeaveGuard } from '@/ui/app-form';

import { createEvent } from '../api';
import { languageOptions, NEW_EVENT_VALUES } from '../form-model';
import { eventPath } from '../paths';
import { createPayload } from '../payload';
import { markRefusals, useRefusedText } from '../refusals';
import { eventFormSchema, type EventFormInput, type EventFormValues } from '../schemas';
import type { EventDetail } from '../types';
import { EventFields } from './event-fields';

type Schemas = components['schemas'];

const schema = eventFormSchema('create');

/**
 * Creates the event and its draft invitation (docs/API.md §6, "Creating an event"). The slug is
 * generated, never asked for. The page replaces itself with the new event, so Back cannot send
 * the form a second time.
 */
export function CreateEvent({
  lead,
  create = createEvent,
}: {
  /** Words of its own, for staff setting one up in a customer's organization. */
  lead?: string;
  create?: (api: ApiClient, body: Schemas['CreateEventDto']) => Promise<EventDetail>;
}) {
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
  useLeaveGuard(form);

  const onSubmit = async (values: EventFormValues) => {
    setProblem(null);
    try {
      const { api } = browserSession();
      const event = await create(api, createPayload(values));
      await navigate(eventPath(event.id), { replace: true });
    } catch (error) {
      setProblem(markRefusals(error, form.setError));
    }
  };

  return (
    <section className="flex max-w-[30rem] flex-col gap-5">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('create.title')}</h1>
      <p className="text-muted-foreground m-0">{lead ?? t('create.lead')}</p>
      {problem ? <ProblemAlert problem={problem} refused={refused} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)} className="gap-5">
        <EventFields form={form} mode="create" zones={zones} languages={languageOptions()} />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting ? t('create.submitting') : t('create.submit')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
