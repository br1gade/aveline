import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { browserSession } from '@/api/session';
import { eventPath, type EventDetail } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import { ChangeableWith } from '@/features/permissions';
import { formatEventDay, formatEventTime } from '@/lib/time';
import { StatusLine, useDialogOpener, usePageStatus, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { inviteToTeam } from '../api';
import type { TeamPageData } from '../load';
import { refusalOf, type TeamRefusal } from '../refusals';
import type { EventRole, OpenInvite, Team, TeamMember } from '../types';
import { InviteForm } from './invite-form';
import { TeamProblem, useRoleName, WRAPPING } from './shared';
import { ChangeRoleDialog, RemoveMemberDialog, WithdrawInviteDialog } from './team-dialogs';

type OpenDialog =
  { kind: 'change' | 'remove'; member: TeamMember } | { kind: 'withdraw'; invite: OpenInvite };

type OpenHandler = (dialog: OpenDialog, opener: HTMLElement) => void;

function useEventMoment(event: EventDetail) {
  const { i18n } = useTranslation('team');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  return (iso: string) => `${formatEventDay(iso, zone)}, ${formatEventTime(iso, zone)}`;
}

function MemberRow({
  member,
  event,
  onOpen,
}: {
  member: TeamMember;
  event: EventDetail;
  onOpen: OpenHandler;
}) {
  const { t } = useTranslation('team');
  const roleName = useRoleName();
  const moment = useEventMoment(event);
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium break-words">{member.name}</span>
        <span className="text-muted-foreground text-sm break-words">{member.email}</span>
      </div>
      <p className="m-0 text-sm">
        {t('members.line', { role: roleName(member.role), since: moment(member.since) })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={WRAPPING}
          aria-label={t('members.changeFor', { name: member.name })}
          onClick={(click) => onOpen({ kind: 'change', member }, click.currentTarget)}
        >
          {t('members.change')}
        </Button>
        <Button
          variant="outline"
          className={WRAPPING}
          aria-label={t('members.removeFor', { name: member.name })}
          onClick={(click) => onOpen({ kind: 'remove', member }, click.currentTarget)}
        >
          {t('members.remove')}
        </Button>
      </div>
    </li>
  );
}

/**
 * Sending an invitation again, at once: it replaces the earlier link, which the status line says.
 * The refusal stays on the page, not in the row: the reload it causes can remove the row.
 */
function useSendAgain(eventId: string, page: PageActions) {
  const { t } = useTranslation('team');
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<TeamRefusal | null>(null);
  const sendAgain = async (email: string, role: EventRole) => {
    setRefusal(null);
    setSendingEmail(email);
    try {
      await inviteToTeam(browserSession().api, eventId, { email, role });
      await page.done(t('status.sentAgain', { email }));
    } catch (error) {
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setSendingEmail(null);
    }
  };
  return { sendingEmail, refusal, sendAgain };
}

type SendAgain = ReturnType<typeof useSendAgain>;

interface InviteRowProps {
  invite: OpenInvite;
  event: EventDetail;
  again: SendAgain;
  onOpen: OpenHandler;
}

/** A role this client doesn't know can't be sent again: it would reissue it as another. */
function InviteRow({ invite, event, again, onOpen }: InviteRowProps) {
  const { t } = useTranslation('team');
  const roleName = useRoleName();
  const moment = useEventMoment(event);
  const { role } = invite;
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <span className="font-medium break-words">{invite.email}</span>
      <p className="m-0 text-sm">
        {t('invites.line', { role: roleName(role), until: moment(invite.expiresAt) })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={WRAPPING}
          disabled={role === null || again.sendingEmail === invite.email}
          aria-label={t('invites.sendAgainFor', { email: invite.email })}
          onClick={() => {
            if (role) void again.sendAgain(invite.email, role);
          }}
        >
          {again.sendingEmail === invite.email ? t('invites.sending') : t('invites.sendAgain')}
        </Button>
        <Button
          variant="outline"
          className={WRAPPING}
          aria-label={t('invites.withdrawFor', { email: invite.email })}
          onClick={(click) => onOpen({ kind: 'withdraw', invite }, click.currentTarget)}
        >
          {t('invites.withdraw')}
        </Button>
      </div>
    </li>
  );
}

function TeamLists({
  team,
  event,
  again,
  onOpen,
}: {
  team: Team;
  event: EventDetail;
  again: SendAgain;
  onOpen: OpenHandler;
}) {
  const { t } = useTranslation('team');
  const membersId = useId();
  const invitesId = useId();
  return (
    <>
      <section aria-labelledby={membersId} className="flex max-w-[40rem] flex-col gap-3">
        <h2 id={membersId} className="m-0 text-lg font-medium">
          {t('members.title')}
        </h2>
        {team.members.length === 0 ? <p className="m-0">{t('members.none')}</p> : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {team.members.map((member) => (
            <MemberRow key={member.userId} member={member} event={event} onOpen={onOpen} />
          ))}
        </ul>
      </section>
      <section aria-labelledby={invitesId} className="flex max-w-[40rem] flex-col gap-3">
        <h2 id={invitesId} className="m-0 text-lg font-medium">
          {t('invites.title')}
        </h2>
        {team.invites.length === 0 ? <p className="m-0">{t('invites.none')}</p> : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {team.invites.map((invite) => (
            <InviteRow
              key={invite.email}
              invite={invite}
              event={event}
              again={again}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

function CurrentDialog({
  dialog,
  ...context
}: {
  dialog: OpenDialog | null;
  eventId: string;
  page: PageActions;
  onClose: () => void;
  restoreFocus: (closing: Event) => void;
}) {
  if (!dialog) return null;
  if (dialog.kind === 'withdraw')
    return <WithdrawInviteDialog {...context} invite={dialog.invite} />;
  return dialog.kind === 'change' ? (
    <ChangeRoleDialog {...context} member={dialog.member} />
  ) : (
    <RemoveMemberDialog {...context} member={dialog.member} />
  );
}

/**
 * The event's team (docs/API.md §6; design PD-99). A role without `member:manage` sees it with
 * nothing to press (FR-6, PD-193); a 403 is still worded. Accepting grants this event and nothing in the organization.
 */
export function TeamPage({ data }: { data: TeamPageData }) {
  const { t } = useTranslation('team');
  const { event, team } = data;
  const { page, status, statusRef } = usePageStatus(data);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const again = useSendAgain(event.id, page);
  const open: OpenHandler = (next, opener) => {
    remember(opener);
    setDialog(next);
  };
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
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {again.refusal ? <TeamProblem refusal={again.refusal} /> : null}
      <ChangeableWith to="member:manage" readOnly={t('refused.forbidden')}>
        {team.kind === 'ready' ? (
          <TeamLists team={team.value} event={event} again={again} onOpen={open} />
        ) : (
          <LoadedProblem loaded={team} refusedText={t('listRefused')} />
        )}
        <InviteForm eventId={event.id} page={page} />
      </ChangeableWith>
      <CurrentDialog
        dialog={dialog}
        eventId={event.id}
        page={page}
        onClose={() => setDialog(null)}
        restoreFocus={restoreFocus}
      />
    </section>
  );
}
