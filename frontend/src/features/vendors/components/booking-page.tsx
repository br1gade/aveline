import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { ArrivalStatus, eventVendorsPath } from '@/features/events';
import { Permitted, useCan } from '@/features/permissions';
import {
  AskFirstDialog,
  StatusLine,
  useDialogAction,
  useDialogOpener,
  usePageStatus,
  WRAPPING_BUTTON,
  type DialogContext,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { changeBooking, endBooking, replaceBriefLink } from '../api';
import type { BookingData } from '../load';
import { vendorRefusalOf, type VendorRefusal } from '../refusals';
import type { Booking } from '../types';
import { BookingForm } from './booking-form';
import { BriefLinkPanel } from './brief-link-panel';
import { Fact, PageHeading, useCategoryText, VendorProblem } from './shared';

type OpenDialog = 'newLink' | 'end';

interface BookingDialogProps extends DialogContext {
  eventId: string;
  booking: Booking;
}

function NewLinkDialog({ eventId, booking, ...context }: BookingDialogProps) {
  const { t } = useTranslation('vendors');
  const action = useDialogAction(context, (error) => vendorRefusalOf(error, 'newLink'));
  return (
    <AskFirstDialog
      onOpenChange={action.onOpenChange}
      onCloseAutoFocus={action.onCloseAutoFocus}
      title={t('newLink.title')}
      body={t('newLink.body', { name: booking.vendor.name })}
      confirmLabel={t('newLink.confirm')}
      isBusy={action.isBusy}
      problem={action.refusal ? <VendorProblem refusal={action.refusal} /> : null}
      onConfirm={() =>
        void action.run(
          () => replaceBriefLink(browserSession().api, { eventId, bookingId: booking.id }),
          t('status.newLink'),
        )
      }
    />
  );
}

function EndDialog({ eventId, booking, ...context }: BookingDialogProps) {
  const { t } = useTranslation('vendors');
  const action = useDialogAction(context, (error) => vendorRefusalOf(error, 'end'));
  return (
    <AskFirstDialog
      onOpenChange={action.onOpenChange}
      onCloseAutoFocus={action.onCloseAutoFocus}
      title={t('end.title', { name: booking.vendor.name })}
      body={t('end.body')}
      confirmLabel={t('end.confirm')}
      isBusy={action.isBusy}
      problem={action.refusal ? <VendorProblem refusal={action.refusal} /> : null}
      onConfirm={() =>
        void action.run(
          () => endBooking(browserSession().api, { eventId, bookingId: booking.id }),
          t('status.ended', { name: booking.vendor.name }),
        )
      }
    />
  );
}

/** Engaging an ended booking again goes at once: it gives the vendor a new link, nothing else. */
function useEngageAgain(eventId: string, booking: Booking, page: PageActions) {
  const { t } = useTranslation('vendors');
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<VendorRefusal | null>(null);
  const engage = async () => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await changeBooking(
        browserSession().api,
        { eventId, bookingId: booking.id },
        { status: 'ENQUIRED' },
      );
      await page.done(t('status.engaged', { name: booking.vendor.name }));
    } catch (error) {
      const found = vendorRefusalOf(error, 'engageAgain');
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { isBusy, refusal, engage: () => void engage() };
}

function VendorFacts({ booking }: { booking: Booking }) {
  const { t } = useTranslation('vendors');
  const categoryText = useCategoryText();
  return (
    <dl className="m-0 grid max-w-[34rem] gap-3">
      <Fact label={t('booking.category')}>{categoryText(booking.vendor.category)}</Fact>
      <Fact label={t('booking.status')}>{t(`statuses.${booking.status}`)}</Fact>
      {booking.vendor.email ? <Fact label={t('list.email')}>{booking.vendor.email}</Fact> : null}
      {booking.vendor.phone ? <Fact label={t('list.phone')}>{booking.vendor.phone}</Fact> : null}
    </dl>
  );
}

interface BookingPanelProps {
  eventId: string;
  booking: Booking;
  page: PageActions;
}

function EndedPanel({ eventId, booking, page }: BookingPanelProps) {
  const { t } = useTranslation('vendors');
  const again = useEngageAgain(eventId, booking, page);
  return (
    <section className="flex max-w-[34rem] flex-col gap-3">
      <p className="m-0">{t('ended.lead')}</p>
      {again.refusal ? <VendorProblem refusal={again.refusal} /> : null}
      {useCan('vendor:write') ? (
        <Button
          className={`self-start ${WRAPPING_BUTTON}`}
          disabled={again.isBusy}
          onClick={again.engage}
        >
          {t('ended.again')}
        </Button>
      ) : null}
    </section>
  );
}

/** Pausing keeps the booking, its fee, sections and link; the link opens nothing meanwhile. */
function useBriefAccess({ eventId, booking, page }: BookingPanelProps) {
  const { t } = useTranslation('vendors');
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<VendorRefusal | null>(null);
  const toggle = async () => {
    const isEnabled = !booking.isBriefEnabled;
    setRefusal(null);
    setIsBusy(true);
    try {
      await changeBooking(
        browserSession().api,
        { eventId, bookingId: booking.id },
        { isBriefEnabled: isEnabled },
      );
      await page.done(
        t(isEnabled ? 'status.resumed' : 'status.paused', { name: booking.vendor.name }),
      );
    } catch (error) {
      const found = vendorRefusalOf(error, 'pause');
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { isBusy, refusal, toggle: () => void toggle() };
}

/**
 * Whether the vendor can open their brief (FR-108, C-56, design PD-192): said to anyone who reads
 * the booking, changed at once by a role with `vendor:write`, since resuming undoes it.
 */
function BriefAccess(props: BookingPanelProps) {
  const { t } = useTranslation('vendors');
  const headingId = useId();
  const access = useBriefAccess(props);
  const { booking } = props;
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('pause.title')}
      </h2>
      <p className="m-0">
        {booking.isBriefEnabled ? t('pause.on', { name: booking.vendor.name }) : t('pause.off')}
      </p>
      {access.refusal ? <VendorProblem refusal={access.refusal} /> : null}
      <Permitted to="vendor:write">
        <Button
          variant="outline"
          className={`self-start ${WRAPPING_BUTTON}`}
          disabled={access.isBusy}
          onClick={access.toggle}
        >
          {booking.isBriefEnabled ? t('pause.pause') : t('pause.resume')}
        </Button>
      </Permitted>
    </section>
  );
}

function BookingBody({
  data,
  page,
  onOpen,
}: {
  data: BookingData;
  page: PageActions;
  onOpen: (dialog: OpenDialog, opener: HTMLElement) => void;
}) {
  const { t } = useTranslation('vendors');
  const { event, booking } = data;
  if (booking.kind === 'missing') return <p className="m-0">{t('booking.missing')}</p>;
  if (booking.kind === 'refused') return <VendorProblem refusal={booking.refusal} />;
  const panel = { eventId: event.id, booking: booking.value, page };
  return (
    <>
      <VendorFacts booking={booking.value} />
      <BriefLinkPanel booking={booking.value} onNewLink={(opener) => onOpen('newLink', opener)} />
      {booking.value.status === 'CANCELLED' ? (
        <EndedPanel {...panel} />
      ) : (
        <>
          <BriefAccess {...panel} />
          <Permitted to="vendor:write">
            <BookingForm {...panel} />
            <Button
              variant="outline"
              className={`self-start ${WRAPPING_BUTTON}`}
              onClick={(click) => onOpen('end', click.currentTarget)}
            >
              {t('end.open')}
            </Button>
          </Permitted>
        </>
      )}
    </>
  );
}

/**
 * One vendor's booking on this event (docs/API.md §6; design PD-122): who they are, the brief link
 * to copy or replace, whether the vendor can open it, the state, sections and fee to correct, and
 * ending it, which asks first. Changes are offered to a role with `vendor:write` (FR-6, PD-190),
 * and a refusal is still worded for the action.
 */
export function BookingPage({ data }: { data: BookingData }) {
  const { t } = useTranslation('vendors');
  const { page, status, statusRef } = usePageStatus(data);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const { event, booking } = data;
  const open = (next: OpenDialog, opener: HTMLElement) => {
    remember(opener);
    setDialog(next);
  };
  const context = { page, onClose: () => setDialog(null), restoreFocus };
  const title = booking.kind === 'ready' ? booking.value.vendor.name : t('booking.title');
  return (
    <section className="flex flex-col gap-6">
      <PageHeading
        back={eventVendorsPath(event.id)}
        backLabel={t('backBookings')}
        title={title}
        subtitle={event.title}
      />
      <ArrivalStatus />
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <BookingBody data={data} page={page} onOpen={open} />
      {booking.kind === 'ready' && dialog === 'newLink' ? (
        <NewLinkDialog {...context} eventId={event.id} booking={booking.value} />
      ) : null}
      {booking.kind === 'ready' && dialog === 'end' ? (
        <EndDialog {...context} eventId={event.id} booking={booking.value} />
      ) : null}
    </section>
  );
}
