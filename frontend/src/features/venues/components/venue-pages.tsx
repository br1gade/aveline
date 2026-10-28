import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { NotifyGuests, type EventDetail, type NotifyOffer } from '@/features/events';

import type { VenueEditData } from '../load';
import { venuesPath } from '../paths';
import { VenueForm } from './venue-form';

/**
 * The form, or the offer to tell guests once a save suggests it. The offer lives only here, never
 * in history: a reload or Back must not offer to send it again (as the event edit does).
 */
function FormOrOffer({ event, venue }: { event: EventDetail; venue: VenueEditData['venue'] }) {
  const { t } = useTranslation('venues');
  const [offer, setOffer] = useState<NotifyOffer | null>(null);
  return offer ? (
    <NotifyGuests offer={offer} back={{ to: venuesPath(event.id), label: t('notify.back') }} />
  ) : (
    <VenueForm event={event} venue={venue} onSuggested={setOffer} />
  );
}

export function NewVenue({ event }: { event: EventDetail }) {
  return <FormOrOffer event={event} venue={null} />;
}

/** A venue removed meanwhile is said so here, with the way back to the list. */
export function EditVenue({ data }: { data: VenueEditData }) {
  const { t } = useTranslation('venues');
  if (!data.venue) {
    return (
      <section className="flex max-w-[34rem] flex-col gap-4">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {t('form.goneTitle')}
        </h1>
        <p className="m-0">{t('form.goneBody')}</p>
        <Link
          to={venuesPath(data.event.id)}
          className="text-primary self-start underline underline-offset-4 hover:no-underline"
        >
          {t('notify.back')}
        </Link>
      </section>
    );
  }
  return <FormOrOffer event={data.event} venue={data.venue} />;
}
