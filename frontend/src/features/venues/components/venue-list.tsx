import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRevalidator } from 'react-router';

import {
  eventPath,
  NotifyGuests,
  type EventDetail,
  type EventNotice,
  type NotifyOffer,
} from '@/features/events';
import { safeExternalUrl } from '@/lib/links';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { EXTERNAL_LINK, Icon } from '@/ui';
import { Button } from '@/ui/kit/button';

import type { VenueListData } from '../load';
import { editVenuePath, newVenuePath } from '../paths';
import type { Venue } from '../types';
import { RemoveVenueDialog } from './remove-venue-dialog';

/** The arrival in the event's own zone, never the device's, with the zone named (R-22). */
function useArrival(venue: Venue, event: EventDetail): string | null {
  const { t, i18n } = useTranslation('venues');
  if (!venue.arriveAt) return null;
  const zone = { timeZone: event.timezone, locale: i18n.language };
  return t('list.arrival', {
    time: formatEventTime(venue.arriveAt, zone),
    date: formatEventDate(venue.arriveAt, zone),
    timeZone: event.timezone.replaceAll('_', ' '),
  });
}

/** Directions as guests get them: only an http or https link reaches the guest page. */
function MapLink({ venue }: { venue: Venue }) {
  const { t } = useTranslation('venues');
  if (!venue.mapUrl) return null;
  const href = safeExternalUrl(venue.mapUrl);
  if (!href) return <p className="text-muted-foreground m-0 text-sm">{t('list.mapUnusable')}</p>;
  return (
    <a
      href={href}
      {...EXTERNAL_LINK}
      className="text-primary self-start text-sm underline underline-offset-4 hover:no-underline"
    >
      {t('list.directions')}
      <Icon name="external-link" size={16} className="ml-1 inline align-[-3px]" />
      <span className="sr-only">{t('list.newTab')}</span>
    </a>
  );
}

interface VenueCardProps {
  venue: Venue;
  event: EventDetail;
  onRemove: (venue: Venue, opener: HTMLElement) => void;
}

function VenueCard({ venue, event, onRemove }: VenueCardProps) {
  const { t } = useTranslation('venues');
  const arrival = useArrival(venue, event);
  const isHidden = venue.role === 'PREPARATION';
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <p className="text-muted-foreground m-0 text-sm">
        {isHidden
          ? t('list.hiddenRole', { role: t(`roles.${venue.role}`) })
          : t(`roles.${venue.role}`)}
      </p>
      <h2 className="m-0 text-base font-medium break-words">{venue.name}</h2>
      <p className="m-0 break-words">{venue.address}</p>
      {arrival ? <p className="m-0 text-sm">{arrival}</p> : null}
      <MapLink venue={venue} />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild variant="outline">
          <Link
            to={editVenuePath(event.id, venue.id)}
            aria-label={t('actionFor', { action: t('list.edit'), name: venue.name })}
          >
            {t('list.edit')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          aria-label={t('actionFor', { action: t('list.remove'), name: venue.name })}
          onClick={(click) => onRemove(venue, click.currentTarget)}
        >
          {t('list.remove')}
        </Button>
      </div>
    </li>
  );
}

/** A removal that went through, waiting for the reloaded list to reach the screen. */
interface Done {
  message: string;
  /** The venues as they were when the removal was sent. */
  before: readonly Venue[];
  offer: NotifyOffer | null;
}

/**
 * The removal dialog, the status line it leaves behind, and the offer its notice may bring. The
 * dialog closes in the render that shows the reloaded list, which React Router applies as a
 * transition, so the focus goes to the status line once the removed venue's button is gone, as the
 * guest list does.
 */
function useRemoval(event: EventDetail, venues: readonly Venue[]) {
  const { t } = useTranslation('venues');
  const { revalidate } = useRevalidator();
  const [target, setTarget] = useState<Venue | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [isOfferAnswered, setIsOfferAnswered] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const isDone = done !== null && venues !== done.before;
  const offer = isDone && !isOfferAnswered ? done.offer : null;
  // Set when the offer is answered: the list comes back, and its status line takes the focus.
  const isStatusFocusDue = useRef(false);
  useEffect(() => {
    if (offer || !isStatusFocusDue.current) return;
    isStatusFocusDue.current = false;
    statusRef.current?.focus();
  }, [offer]);

  const open = useCallback((venue: Venue, opener: HTMLElement) => {
    openerRef.current = opener;
    setDone(null);
    setTarget(venue);
  }, []);
  const close = useCallback(() => setTarget(null), []);
  const dismissOffer = () => {
    isStatusFocusDue.current = true;
    setIsOfferAnswered(true);
  };
  const removed = async (notice: EventNotice) => {
    const message = t('list.removed', { name: target?.name ?? '' });
    const { invitation } = event;
    const suggested =
      notice.isSuggested && invitation
        ? { slug: invitation.slug, households: notice.householdsInvited }
        : null;
    await revalidate();
    setIsOfferAnswered(false);
    setDone({ message, before: venues, offer: suggested });
  };
  // Radix puts the focus back on its own trigger; after a removal the opener is gone.
  const restoreFocus = useCallback((closing: Event) => {
    closing.preventDefault();
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
    else statusRef.current?.focus();
  }, []);
  return {
    target: isDone ? null : target,
    open,
    close,
    removed,
    restoreFocus,
    status: isDone ? done.message : '',
    statusRef,
    offer,
    dismissOffer,
    revalidate,
  };
}

function StatusLine({
  statusRef,
  children,
}: {
  statusRef: RefObject<HTMLParagraphElement | null>;
  children: string;
}) {
  return (
    <p ref={statusRef} role="status" tabIndex={-1} className="m-0 text-sm font-medium outline-none">
      {children}
    </p>
  );
}

/**
 * An event's venues (docs/API.md §6, "Venues"; design PD-46): where guests go, in the order they
 * were added. Adding and correcting are pages; removing asks first, and a removal whose notice
 * suggests it becomes the offer to tell guests, in place of the list until the host answers.
 */
export function VenueList({ data }: { data: VenueListData }) {
  const { t } = useTranslation('venues');
  const { event, venues } = data;
  const removal = useRemoval(event, venues);

  if (removal.offer) {
    const back = { label: t('notify.back'), onClick: removal.dismissOffer };
    return <NotifyGuests offer={removal.offer} back={back} />;
  }
  return (
    <section className="flex flex-col gap-5">
      <Link
        to={eventPath(event.id)}
        className="text-primary self-start underline underline-offset-4 hover:no-underline"
      >
        {t('list.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('list.title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('list.lead')}</p>
      <Button asChild className="self-start">
        <Link to={newVenuePath(event.id)}>{t('list.add')}</Link>
      </Button>
      <StatusLine statusRef={removal.statusRef}>{removal.status}</StatusLine>
      {venues.length === 0 ? (
        <p className="text-muted-foreground m-0">{t('list.empty')}</p>
      ) : (
        <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-4 p-0">
          {venues.map((venue) => (
            <VenueCard key={venue.id} venue={venue} event={event} onRemove={removal.open} />
          ))}
        </ul>
      )}
      {removal.target ? (
        <RemoveVenueDialog
          key={removal.target.id}
          eventId={event.id}
          venue={removal.target}
          onRemoved={removal.removed}
          onStale={() => void removal.revalidate()}
          onClose={removal.close}
          onCloseAutoFocus={removal.restoreFocus}
        />
      ) : null}
    </section>
  );
}
