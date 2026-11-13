import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { data } from 'react-router';

import { createPublicApi } from '@/api/client';
import { readPublicEnv } from '@/config/env';
import { GuestGallery } from '@/features/gallery';
import { AgreeBeforeDoor, AgreementsNotice, useDoorAgreements } from '@/features/guest-agreements';
import { NameCorrection, withCorrectedName, type CorrectedName } from '@/features/guest-name';
import {
  GuestReply,
  ReconfirmNotice,
  replySummaryFrom,
  type ReplyRecord,
} from '@/features/guest-reply';
import { loadReply } from '@/features/guest-reply/index.server';
import {
  guestArtworkLoader,
  InvitationNotFound,
  InvitationPage,
  invitationLanguage,
  invitationMeta,
  type Invitation,
} from '@/features/invitation-renderer';
import { loadInvitationPage } from '@/features/invitation-renderer/index.server';
import { Notice } from '@/ui';
import { LeaveGuard } from '@/ui/app-form';

import type { Route } from './+types/guest-invitation';

/**
 * A guest's personal link. The token in the URL is their credential (root CLAUDE.md §3): it goes
 * to the API and nowhere else. entry.server.tsx keeps every response for this path out of caches,
 * referrers and indexes, errors included. The invitation and the saved reply are read in parallel.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const link = { slug: params.slug, guestToken: params.guestToken };
  const locale = new URL(request.url).searchParams.get('locale') ?? undefined;
  const [page, record] = await Promise.all([
    loadInvitationPage({ ...link, locale }, request),
    loadReply(link, request),
  ]);
  return data({ ...page, record }, { status: page.state === 'found' ? 200 : 404 });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return invitationMeta(loaderData);
}

export const handle = { pageLanguage: invitationLanguage };

/** The same personal link in another language; the token stays in the path, nowhere else. */
function languageHref(language: string): string {
  return `?locale=${language}`;
}

interface PersonalPageProps {
  invitation: Invitation;
  savedRecord: ReplyRecord | null;
  link: { slug: string; guestToken: string };
}

/** The reply as read, with the guest's own name as they last corrected it (PD-64). */
function withName(record: ReplyRecord, corrected: CorrectedName): ReplyRecord {
  const { firstName, lastName } = corrected;
  return { ...record, guest: { ...record.guest, firstName, lastName } };
}

/** In the browser only: a picture's address holds the token, and goes where every guest call goes. */
function useGuestArtwork({ slug, guestToken }: PersonalPageProps['link']) {
  return useMemo(
    () =>
      guestArtworkLoader(createPublicApi(readPublicEnv().VITE_API_BASE_URL), { slug, guestToken }),
    [slug, guestToken],
  );
}

function PersonalPage({ invitation: read, savedRecord, link }: PersonalPageProps) {
  const { t } = useTranslation('reply');
  const artwork = useGuestArtwork(link);
  const [record, setRecord] = useState(savedRecord);
  const [isSent, setIsSent] = useState(false);
  const [corrected, setCorrected] = useState<CorrectedName | null>(null);
  const invitation = corrected ? withCorrectedName(read, corrected) : read;
  // Agreeing before the door (PD-83): what is left to agree, shared by the card and the section.
  const door = useDoorAgreements(invitation, link, record);
  const onCorrected = (name: CorrectedName) => {
    setCorrected(name);
    setRecord((current) => current && withName(current, name));
  };
  // Correcting needs both names apart, which only the reply read holds.
  const renderPersonal = record
    ? () => (
        <>
          <ReconfirmNotice record={record} />
          <AgreementsNotice door={door} />
          <NameCorrection
            saved={record.guest}
            link={link}
            locale={invitation.locale}
            onCorrected={onCorrected}
          />
        </>
      )
    : undefined;
  const renderReply = () =>
    record ? (
      <GuestReply
        invitation={invitation}
        link={link}
        record={record}
        onReplied={setRecord}
        onSentChange={setIsSent}
        agreementsVersion={door.version}
      />
    ) : (
      <Notice tone="error">{t('errors.loadFailed')}</Notice>
    );
  // A reply half-typed asks before the page is left, as the app's forms do (design PD-146).
  return (
    <LeaveGuard>
      <InvitationPage
        invitation={invitation}
        reply={record ? replySummaryFrom(record) : undefined}
        renderReply={renderReply}
        replyHeading={isSent ? t('sent.heading') : undefined}
        languageHref={languageHref}
        renderPersonal={renderPersonal}
        artwork={artwork}
        renderContributions={() => (
          <div className="flex flex-col gap-16">
            <AgreeBeforeDoor door={door} link={link} />
            <GuestGallery invitation={invitation} link={link} />
          </div>
        )}
      />
    </LeaveGuard>
  );
}

export default function GuestInvitation({ loaderData, params }: Route.ComponentProps) {
  if (loaderData.state === 'not-found') {
    return <InvitationNotFound />;
  }
  return (
    <PersonalPage
      invitation={loaderData.invitation}
      savedRecord={loaderData.record}
      link={{ slug: params.slug, guestToken: params.guestToken }}
    />
  );
}
