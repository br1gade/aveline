import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath } from '@/features/events';

import type { InvitationPageData } from '../load';
import { usePageStatus } from './page-status';
import { PublishPanel } from './publish-panel';
import { RepliesPanel } from './replies-panel';
import { SendPanel } from './send-panel';

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
 * The invitation's way out (design PD-47): while a draft, what blocks publishing and the way to
 * publish; once published, stopping and taking replies, and sending. Every action is offered to
 * every role, and a 403 is explained when it happens (FR-6).
 */
export function InvitationPage({ data }: { data: InvitationPageData }) {
  const { t } = useTranslation('sending');
  const { event, draft, delivery } = data;
  const { invitation } = event;
  const { page, status, statusRef } = usePageStatus(data);
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={eventPath(event.id)}
        className="text-primary self-start underline underline-offset-4 hover:no-underline"
      >
        {t('page.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('page.title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      {invitation ? (
        <dl className="bg-card border-border m-0 flex max-w-[40rem] flex-col gap-1 border px-5 py-4">
          <dt className="text-muted-foreground text-sm">{t('page.status')}</dt>
          <dd className="m-0">{t(`page.state.${invitation.status}`)}</dd>
          <dt className="text-muted-foreground pt-2 text-sm">{t('page.slug')}</dt>
          <dd className="m-0 break-all">{invitation.slug}</dd>
        </dl>
      ) : (
        <p className="m-0">{t('page.noInvitation')}</p>
      )}
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {invitation?.status === 'DRAFT' && draft ? (
        <PublishPanel eventId={event.id} slug={invitation.slug} draft={draft} page={page} />
      ) : null}
      {invitation && invitation.status !== 'DRAFT' ? (
        <>
          <RepliesPanel slug={invitation.slug} status={invitation.status} page={page} />
          <SendPanel
            event={event}
            slug={invitation.slug}
            isPublished={invitation.status === 'PUBLISHED'}
            delivery={delivery}
          />
        </>
      ) : null}
    </section>
  );
}
