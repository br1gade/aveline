import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { EventDetail, EventNotice, NotifyOffer } from '@/features/events';
import { AppForm, ProblemAlert, SubmitButton } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { createVenue, updateVenue } from '../api';
import { NEW_VENUE_VALUES, venueFormValues } from '../form-model';
import { venuesPath } from '../paths';
import { createVenuePayload, updateVenuePayload } from '../payload';
import { markRefusals, useRefusedText } from '../refusals';
import { venueFormSchema, type VenueFormInput, type VenueFormValues } from '../schemas';
import type { Venue } from '../types';
import { VenueFields } from './venue-fields';

interface VenueFormProps {
  event: EventDetail;
  /** The venue to correct; none to add one. */
  venue: Venue | null;
  onSuggested: (offer: NotifyOffer) => void;
}

/** Sends the form; `null` when a correction changed nothing, so nothing was sent. */
async function saveVenue(
  event: EventDetail,
  baseline: VenueFormValues | null,
  values: VenueFormValues,
  venueId: string | undefined,
): Promise<EventNotice | null> {
  const { api } = browserSession();
  if (!baseline || !venueId) {
    return createVenue(api, event.id, createVenuePayload(values, event.timezone));
  }
  const body = updateVenuePayload(baseline, values, event.timezone);
  if (Object.keys(body).length === 0) return null;
  return updateVenue(api, event.id, venueId, body);
}

/**
 * Adding a venue, or correcting one (design PD-46): one form, at most 30 rem wide, as the event's
 * own (PD-42). A correction sends only what changed. When guests already hold the invitation, the
 * save's notice may suggest telling them, and the page becomes that offer.
 */
export function VenueForm({ event, venue, onSuggested }: VenueFormProps) {
  const { t } = useTranslation('venues');
  const navigate = useNavigate();
  const refused = useRefusedText(venue ? 'edit' : 'create');
  const [problem, setProblem] = useState<Problem | null>(null);
  const schema = useMemo(() => venueFormSchema(event.timezone), [event.timezone]);
  // The baseline is the venue as the form first showed it, as the event form's is: a later reload
  // of the page must not move it.
  const [baseline] = useState(() => (venue ? venueFormValues(venue, event.timezone) : null));
  const form = useForm<VenueFormInput, unknown, VenueFormValues>({
    resolver: zodResolver(schema),
    defaultValues: baseline ?? NEW_VENUE_VALUES,
  });
  const { isSubmitting } = form.formState;

  const onSubmit = async (values: VenueFormValues) => {
    setProblem(null);
    try {
      const notice = await saveVenue(event, baseline, values, venue?.id);
      if (notice?.isSuggested && event.invitation) {
        onSuggested({ slug: event.invitation.slug, households: notice.householdsInvited });
      } else {
        await navigate(venuesPath(event.id));
      }
    } catch (error) {
      setProblem(markRefusals(error, form.setError));
    }
  };

  return (
    <section className="flex max-w-[30rem] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {venue ? t('form.editTitle', { name: venue.name }) : t('form.newTitle')}
        </h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0">{t('form.lead')}</p>
      {problem ? <ProblemAlert problem={problem} refused={refused} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)} className="gap-5">
        <VenueFields form={form} timeZone={event.timezone} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton isSubmitting={isSubmitting} className="w-auto">
            {isSubmitting
              ? t(venue ? 'form.saving' : 'form.adding')
              : t(venue ? 'form.editSubmit' : 'form.newSubmit')}
          </SubmitButton>
          <Button asChild variant="ghost">
            <Link to={venuesPath(event.id)}>{t('form.cancel')}</Link>
          </Button>
        </div>
      </AppForm>
    </section>
  );
}
