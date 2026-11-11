import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { bookingPath, eventPath, newBookingPath } from '@/features/events';
import { APP_PATHS } from '@/route-paths';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Permitted } from '@/features/permissions';

import type { EventVendorsData } from '../load';
import type { Booking } from '../types';
import {
  BACK_LINK,
  PageHeading,
  useCategoryText,
  useFeeText,
  useSectionsText,
  VendorProblem,
} from './shared';

function BookingRow({ eventId, booking }: { eventId: string; booking: Booking }) {
  const { t } = useTranslation('vendors');
  const categoryText = useCategoryText();
  const sectionsText = useSectionsText();
  const feeText = useFeeText();
  return (
    <li className="bg-card border-border flex flex-col gap-1 border px-5 py-4">
      <span className="font-medium break-words">{booking.vendor.name}</span>
      <p className="m-0 text-sm">
        {categoryText(booking.vendor.category)} · {t(`statuses.${booking.status}`)}
        {booking.isBriefEnabled || booking.status === 'CANCELLED'
          ? ''
          : ` · ${t('bookings.paused')}`}
      </p>
      <p className="m-0 text-sm">
        {t('pair', { label: t('booking.shares'), value: sectionsText(booking.scopes) })}
      </p>
      <p className="m-0 text-sm">
        {t('pair', { label: t('booking.fee'), value: feeText(booking.fee) })}
      </p>
      <Link
        to={bookingPath(eventId, booking.id)}
        className={BACK_LINK}
        aria-label={t('bookings.openFor', { name: booking.vendor.name })}
      >
        {t('bookings.open')}
      </Link>
    </li>
  );
}

function BookingList({ eventId, bookings }: { eventId: string; bookings: readonly Booking[] }) {
  const { t } = useTranslation('vendors');
  if (bookings.length === 0) return <p className="m-0">{t('bookings.empty')}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {bookings.map((booking) => (
        <BookingRow key={booking.id} eventId={eventId} booking={booking} />
      ))}
    </ul>
  );
}

/**
 * Who is engaged for this event (docs/API.md §6; design PD-121, PD-122): each vendor, the booking's
 * state, what their brief shares and the fee, which a role without `vendor:fee:read` is told is
 * not theirs to see, and a paused brief (FR-108). Booking is offered with `vendor:write` (FR-6,
 * PD-190). A designer can't read vendors at all, and is told so.
 */
export function EventVendorsPage({ data }: { data: EventVendorsData }) {
  const { t } = useTranslation('vendors');
  const headingId = useId();
  const { event, bookings } = data;
  return (
    <section className="flex flex-col gap-6">
      <PageHeading
        back={eventPath(event.id)}
        backLabel={t('backEvent')}
        title={t('bookings.title')}
        subtitle={event.title}
      />
      <p className="m-0 max-w-[40rem]">{t('bookings.lead')}</p>
      <div className="flex flex-wrap gap-2">
        <Permitted to="vendor:write">
          <Button asChild className={WRAPPING_BUTTON}>
            <Link to={newBookingPath(event.id)}>{t('bookings.book')}</Link>
          </Button>
        </Permitted>
        <Button asChild variant="outline" className={WRAPPING_BUTTON}>
          <Link to={APP_PATHS.vendors}>{t('bookings.organization')}</Link>
        </Button>
      </div>
      <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
        <h2 id={headingId} className="m-0 text-lg font-medium">
          {t('bookings.listTitle')}
        </h2>
        {bookings.kind === 'refused' ? (
          <VendorProblem refusal={bookings.refusal} />
        ) : (
          <BookingList eventId={event.id} bookings={bookings.value} />
        )}
      </section>
    </section>
  );
}
