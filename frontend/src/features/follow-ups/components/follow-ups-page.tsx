import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import { StatusLine, usePageStatus, type PageActions } from '@/ui/app-form';

import { chaseOffer, expectedChase, expectedThanks, thankOffer } from '../audience';
import type { FollowUpsData } from '../load';
import { AutomaticReminders } from './automatic-reminders';
import { ChasePanel } from './chase-panel';
import { ThankPanel } from './thank-panel';

/** Both expected audiences, once both reads are in; `null` until then, or if either failed. */
function useAudiences({ event, guests, delivery, now }: FollowUpsData) {
  return useMemo(() => {
    if (guests?.kind !== 'ready' || delivery?.kind !== 'ready') return null;
    const clock = { startsAt: event.startsAt, now };
    return {
      chase: expectedChase(guests.value, delivery.value, clock),
      thanks: expectedThanks(guests.value, delivery.value),
    };
  }, [event.startsAt, guests, delivery, now]);
}

/** Why "who gets it" can't be shown: this role may not read it, or a read failed. */
function ExpectedProblem({ data }: { data: FollowUpsData }) {
  const { t } = useTranslation('follow-ups');
  for (const read of [data.guests, data.delivery]) {
    if (read && read.kind !== 'ready') {
      return <LoadedProblem loaded={read} refusedText={t('expected.refused')} />;
    }
  }
  return null;
}

function Panels({ data, page }: { data: FollowUpsData; page: PageActions }) {
  const { t } = useTranslation('follow-ups');
  const audiences = useAudiences(data);
  const { event, now } = data;
  const { invitation } = event;
  if (!invitation) return <p className="m-0">{t('noInvitation')}</p>;
  return (
    <>
      {audiences ? (
        <p className="text-muted-foreground m-0 max-w-[40rem] text-sm">{t('expected.lead')}</p>
      ) : (
        <ExpectedProblem data={data} />
      )}
      <AutomaticReminders event={event} page={page} />
      <ChasePanel
        eventId={event.id}
        slug={invitation.slug}
        offer={chaseOffer(invitation, event.startsAt, now)}
        audience={audiences?.chase ?? null}
      />
      <ThankPanel
        eventId={event.id}
        slug={invitation.slug}
        offer={thankOffer(invitation, event.startsAt, now)}
        audience={audiences?.thanks ?? null}
      />
    </>
  );
}

/**
 * Reminders and thanks (design PD-95): each panel says who is expected to get it, asks, then shows
 * what the server did. Every action is offered to every role, and a 403 is worded when it happens
 * (FR-6); only a state the backend refuses, or one it should (FR-86), takes the button away.
 */
export function FollowUpsPage({ data }: { data: FollowUpsData }) {
  const { t } = useTranslation('follow-ups');
  const { event } = data;
  const { page, status, statusRef } = usePageStatus(data);
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={eventPath(event.id)}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <Panels data={data} page={page} />
    </section>
  );
}
