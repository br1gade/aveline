import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  ArchivedNotice,
  eventPath,
  followUpsPath,
  type EventDetail,
  type InvitationStatus,
} from '@/features/events';
import { formatEventDay, formatEventTime } from '@/lib/time';
import { StatusLine, usePageStatus, type PageActions } from '@/ui/app-form';

import type { InvitationPageData } from '../load';
import { PublishPanel } from './publish-panel';
import { RepliesPanel } from './replies-panel';
import { SendPanel } from './send-panel';
import { TellGuests, TellGuestsPanel } from './tell-guests';

/**
 * How long guests can open it (design PD-55): set when it is first published, from the event's plan
 * (free: 90 days after the event), and moved with the event's dates. Nothing for a draft.
 */
function Lifetime({ event }: { event: EventDetail }) {
  const { t, i18n } = useTranslation('sending');
  const { invitation } = event;
  if (!invitation || invitation.status === 'DRAFT' || invitation.expiresAt === undefined) {
    return null;
  }
  const zone = { timeZone: event.timezone, locale: i18n.language };
  let words = t('page.noExpiry');
  if (invitation.isExpired) words = t('page.expired');
  else if (invitation.expiresAt) {
    const at = invitation.expiresAt;
    words = t('page.openUntil', {
      date: formatEventDay(at, zone),
      time: formatEventTime(at, zone),
    });
  }
  return (
    <>
      <dt className="text-muted-foreground pt-2 text-sm">{t('page.lifetime')}</dt>
      <dd className="m-0">{words}</dd>
    </>
  );
}

interface PublishedProps {
  event: EventDetail;
  /** Never a draft: a draft has the publish panel instead. */
  invitation: NonNullable<EventDetail['invitation']> & {
    status: Exclude<InvitationStatus, 'DRAFT'>;
  };
  delivery: InvitationPageData['delivery'];
  page: PageActions;
  onTell: () => void;
}

/** Once published: replies, sending, telling guests about a change, and the follow-ups. */
function Published({ event, invitation, delivery, page, onTell }: PublishedProps) {
  const { t } = useTranslation('sending');
  const isExpired = invitation.isExpired === true;
  return (
    <>
      <RepliesPanel
        slug={invitation.slug}
        status={invitation.status}
        isExpired={isExpired}
        page={page}
      />
      <SendPanel
        event={event}
        slug={invitation.slug}
        isPublished={invitation.status === 'PUBLISHED'}
        isExpired={isExpired}
        delivery={delivery}
      />
      {isExpired ? null : <TellGuestsPanel onOpen={onTell} />}
      <Link
        to={followUpsPath(event.id)}
        className="text-primary inline-flex min-h-11 max-w-[40rem] items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('page.followUps')}
      </Link>
    </>
  );
}

function InvitationFacts({ event }: { event: EventDetail }) {
  const { t } = useTranslation('sending');
  const { invitation } = event;
  if (!invitation) return <p className="m-0">{t('page.noInvitation')}</p>;
  return (
    <dl className="bg-card border-border m-0 flex max-w-[40rem] flex-col gap-1 border px-5 py-4">
      <dt className="text-muted-foreground text-sm">{t('page.status')}</dt>
      <dd className="m-0">{t(`page.state.${invitation.status}`)}</dd>
      <dt className="text-muted-foreground pt-2 text-sm">{t('page.slug')}</dt>
      <dd className="m-0 break-all">{invitation.slug}</dd>
      <Lifetime event={event} />
    </dl>
  );
}

/**
 * The invitation's way out (design PD-47): while a draft, what blocks publishing and the way to
 * publish; once published, stopping and taking replies, sending, and telling guests about a change
 * (PD-177), which takes the page's place until the host answers. Every action is offered to every
 * role, and a 403 is explained when it happens (FR-6).
 */
export function InvitationPage({ data }: { data: InvitationPageData }) {
  const { t } = useTranslation('sending');
  const { event, draft, delivery } = data;
  const { invitation } = event;
  const { page, status, statusRef } = usePageStatus(data);
  const [isTelling, setIsTelling] = useState(false);
  if (isTelling && invitation) {
    return <TellGuests slug={invitation.slug} onBack={() => setIsTelling(false)} />;
  }
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={eventPath(event.id)}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('page.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('page.title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <InvitationFacts event={event} />
      <ArchivedNotice event={event} where="invitation" />
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {invitation?.status === 'DRAFT' && draft ? (
        <PublishPanel eventId={event.id} slug={invitation.slug} draft={draft} page={page} />
      ) : null}
      {invitation && invitation.status !== 'DRAFT' ? (
        <Published
          event={event}
          invitation={{ ...invitation, status: invitation.status }}
          delivery={delivery}
          page={page}
          onTell={() => setIsTelling(true)}
        />
      ) : null}
    </section>
  );
}
