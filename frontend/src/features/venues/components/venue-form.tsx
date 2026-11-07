import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { EventDetail, EventNotice, NotifyOffer } from '@/features/events';
import { AppForm, ProblemAlert, SubmitButton, useLeaveGuard } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { createVenue, updateVenue } from '../api';
import { newVenueValues, venueFormValues, venueLanguages } from '../form-model';
import type { NewVenueData } from '../load';
import { venuesPath } from '../paths';
import { createVenuePayload, updateVenuePayload } from '../payload';
import { isHallRetired, markRefusals, refusalMessages, useRefusedText } from '../refusals';
import { venueFormSchema, type VenueFormInput, type VenueFormValues } from '../schemas';
import type { DirectoryHall, Venue } from '../types';
import { DirectoryPicker } from './directory-picker';
import { VenueFields } from './venue-fields';

interface VenueFormProps {
  event: EventDetail;
  /** The venue to correct; none to add one. */
  venue: Venue | null;
  /** Halls to start from, when adding: `PATCH` takes no `profileId`. */
  directory?: NewVenueData['directory'] | undefined;
  /** The chosen hall left the directory meanwhile: read it again. */
  onHallRetired?: (() => void) | undefined;
  onSuggested: (offer: NotifyOffer) => void;
}

/** What a save writes to: a correction of `venueId` from its baseline, or a new venue. */
interface SaveTarget {
  baseline: VenueFormValues | null;
  venue: Venue | null;
  hall: DirectoryHall | null;
}

/** Sends the form; `null` when a correction changed nothing, so nothing was sent. */
async function saveVenue(
  event: EventDetail,
  { baseline, venue, hall }: SaveTarget,
  values: VenueFormValues,
): Promise<EventNotice | null> {
  const { api } = browserSession();
  if (!baseline || !venue) {
    return createVenue(api, event.id, createVenuePayload(values, event.timezone, hall?.id));
  }
  const body = updateVenuePayload(baseline, values, event.timezone, venue.translations);
  if (Object.keys(body).length === 0) return null;
  return updateVenue(api, event.id, venue.id, body);
}

function FormActions({
  eventId,
  isEditing,
  isSubmitting,
}: {
  eventId: string;
  isEditing: boolean;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation('venues');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SubmitButton isSubmitting={isSubmitting} className="w-auto">
        {isSubmitting
          ? t(isEditing ? 'form.saving' : 'form.adding')
          : t(isEditing ? 'form.editSubmit' : 'form.newSubmit')}
      </SubmitButton>
      <Button asChild variant="ghost">
        <Link to={venuesPath(eventId)}>{t('form.cancel')}</Link>
      </Button>
    </div>
  );
}

function FormHeading({ event, venue }: { event: EventDetail; venue: Venue | null }) {
  const { t } = useTranslation('venues');
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {venue ? t('form.editTitle', { name: venue.name }) : t('form.newTitle')}
        </h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0">{t('form.lead')}</p>
    </>
  );
}

/**
 * The form and its baseline: the venue as the form first showed it, as the event form's is, so a
 * later reload of the page doesn't move it. Leaving with unsaved changes asks first (PD-119).
 */
function useVenueForm(event: EventDetail, venue: Venue | null) {
  const schema = useMemo(() => venueFormSchema(event.timezone), [event.timezone]);
  const [languages] = useState(() => venueLanguages(event, venue));
  const [baseline] = useState(() =>
    venue ? venueFormValues(venue, event.timezone, languages) : null,
  );
  const form = useForm<VenueFormInput, unknown, VenueFormValues>({
    resolver: zodResolver(schema),
    defaultValues: baseline ?? newVenueValues(languages),
  });
  useLeaveGuard(form);
  return { form, baseline, languages };
}

/**
 * Adding a venue, or correcting one (design PD-46): one form, at most 30 rem wide, as the event's
 * own (PD-42). A correction sends only what changed. When guests already hold the invitation, the
 * save's notice may suggest telling them, and the page becomes that offer.
 */
export function VenueForm({ event, venue, directory, onHallRetired, onSuggested }: VenueFormProps) {
  const navigate = useNavigate();
  const [hall, setHall] = useState<DirectoryHall | null>(null);
  const refused = useRefusedText(venue ? 'edit' : 'create');
  const [problem, setProblem] = useState<{ problem: Problem; messages: readonly string[] } | null>(
    null,
  );
  const { form, baseline, languages } = useVenueForm(event, venue);
  const { isSubmitting } = form.formState;

  const dropHall = () => {
    setHall(null);
    onHallRetired?.();
  };

  const onSubmit = async (values: VenueFormValues) => {
    setProblem(null);
    try {
      const notice = await saveVenue(event, { baseline, venue, hall }, values);
      if (notice?.isSuggested && event.invitation) {
        onSuggested({ slug: event.invitation.slug, households: notice.householdsInvited });
      } else {
        await navigate(venuesPath(event.id));
      }
    } catch (error) {
      const messages = refusalMessages(error);
      setProblem({ problem: markRefusals(error, form.setError), messages });
      if (isHallRetired(messages)) dropHall();
    }
  };

  return (
    <section className="flex max-w-[30rem] flex-col gap-5">
      <FormHeading event={event} venue={venue} />
      {problem ? (
        <ProblemAlert
          problem={problem.problem}
          refused={(status) => refused(status, problem.messages)}
        />
      ) : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)} className="gap-5">
        {directory ? (
          <DirectoryPicker directory={directory} form={form} hall={hall} onChoose={setHall} />
        ) : null}
        <VenueFields
          form={form}
          timeZone={event.timezone}
          languages={languages}
          defaultLocale={event.defaultLocale}
        />
        <FormActions eventId={event.id} isEditing={venue !== null} isSubmitting={isSubmitting} />
      </AppForm>
    </section>
  );
}
