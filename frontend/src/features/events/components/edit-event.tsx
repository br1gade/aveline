import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { timeZoneOptions } from '@/lib/time';
import { AppForm, ProblemAlert, SubmitButton } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { updateEvent } from '../api';
import { formValuesOf, languageOptions } from '../form-model';
import { eventPath } from '../paths';
import { updatePayload } from '../payload';
import { markRefusals, useRefusedText } from '../refusals';
import { eventFormSchema, type EventFormInput, type EventFormValues } from '../schemas';
import type { EventDetail } from '../types';
import { EventFields } from './event-fields';
import { NotifyGuests, type NotifyOffer } from './notify-guests';

const schema = eventFormSchema('edit');

interface EditFormProps {
  event: EventDetail;
  onSuggested: (offer: NotifyOffer) => void;
}

/** Sends only what the host changed, and nothing at all when nothing did. */
function EditForm({ event, onSuggested }: EditFormProps) {
  const { t } = useTranslation('events');
  const navigate = useNavigate();
  const refused = useRefusedText('edit');
  const [problem, setProblem] = useState<Problem | null>(null);
  // The baseline is the event as the form first showed it, as the form's own values are. A later
  // reload of this page (a language switch, say) must not move it, or a save would send back
  // whatever someone else changed meanwhile.
  const [initial] = useState(() => formValuesOf(event));
  const zones = useMemo(() => timeZoneOptions(initial.timezone), [initial.timezone]);
  const form = useForm<EventFormInput, unknown, EventFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });
  const { isSubmitting } = form.formState;

  const onSubmit = async (values: EventFormValues) => {
    setProblem(null);
    const body = updatePayload(initial, values);
    if (Object.keys(body).length === 0) {
      await navigate(eventPath(event.id));
      return;
    }
    try {
      const { notice, invitation } = await updateEvent(browserSession().api, event.id, body);
      if (notice.isSuggested && invitation) {
        onSuggested({ slug: invitation.slug, households: notice.householdsInvited });
      } else {
        await navigate(eventPath(event.id));
      }
    } catch (error) {
      setProblem(markRefusals(error, form.setError));
    }
  };

  return (
    <section className="flex max-w-[30rem] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('edit.title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0">{t('edit.lead')}</p>
      {problem ? <ProblemAlert problem={problem} refused={refused} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)} className="gap-5">
        <EventFields
          form={form}
          mode="edit"
          zones={zones}
          languages={languageOptions(event.locales)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton isSubmitting={isSubmitting} className="w-auto">
            {isSubmitting ? t('edit.submitting') : t('edit.submit')}
          </SubmitButton>
          <Button asChild variant="ghost">
            <Link to={eventPath(event.id)}>{t('edit.cancel')}</Link>
          </Button>
        </div>
      </AppForm>
    </section>
  );
}

/**
 * Correcting an event's details (docs/API.md §6, "Correcting an event"). When the date or zone
 * moved and guests hold the invitation, the page becomes the offer to tell them. The offer lives
 * only here, never in history: a reload or Back must not offer to send it again.
 */
export function EditEvent({ event }: { event: EventDetail }) {
  const { t } = useTranslation('events');
  const [offer, setOffer] = useState<NotifyOffer | null>(null);
  return offer ? (
    <NotifyGuests offer={offer} back={{ to: eventPath(event.id), label: t('notify.back') }} />
  ) : (
    <EditForm event={event} onSuggested={setOffer} />
  );
}
