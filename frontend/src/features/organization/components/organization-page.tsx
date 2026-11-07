import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LoadedProblem } from '@/features/sending';
import { APP_PATHS } from '@/route-paths';
import { StatusLine, useDialogOpener, usePageStatus, type DialogContext } from '@/ui/app-form';

import type { OrganizationData } from '../load';
import type { OrganizationInvite, OrganizationMember } from '../types';
import { Invites } from './invites';
import { Leaving } from './leaving';
import {
  ChangeRoleDialog,
  MakeOwnerDialog,
  RemoveMemberDialog,
  WithdrawInviteDialog,
} from './member-dialogs';
import { MemberList, type MemberAction, type OpenMemberDialog } from './member-list';
import { NameForm } from './name-form';

type OpenDialog =
  | { kind: MemberAction; member: OrganizationMember; revision: number }
  | { kind: 'withdraw'; invite: OrganizationInvite };

/**
 * A dialog stays open when a write is refused because someone else got there first, and the page is
 * read again behind it, so it goes on with what was just read: pressing again is then a fresh try.
 */
function liveRevision(dialog: { revision: number }, members: OrganizationData['members']): number {
  return members.kind === 'ready'
    ? Math.max(dialog.revision, members.value.accessRevision)
    : dialog.revision;
}

interface CurrentDialogProps extends DialogContext {
  dialog: OpenDialog | null;
  members: OrganizationData['members'];
}

function CurrentDialog({ dialog, members, ...context }: CurrentDialogProps) {
  if (!dialog) return null;
  if (dialog.kind === 'withdraw') {
    return <WithdrawInviteDialog {...context} invite={dialog.invite} />;
  }
  const { member } = dialog;
  const revision = liveRevision(dialog, members);
  if (dialog.kind === 'change') {
    return <ChangeRoleDialog {...context} member={member} revision={revision} />;
  }
  if (dialog.kind === 'owner') {
    return <MakeOwnerDialog {...context} member={member} revision={revision} />;
  }
  return <RemoveMemberDialog {...context} member={member} revision={revision} />;
}

function Members({
  members,
  onOpen,
}: {
  members: OrganizationData['members'];
  onOpen: OpenMemberDialog;
}) {
  const { t } = useTranslation('organization');
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('members.title')}
      </h2>
      {members.kind === 'ready' ? (
        <>
          <p className="m-0">{t('members.lead')}</p>
          {/* What a write changes starts the list again, with the revision it now has. */}
          <MemberList key={members.value.accessRevision} first={members.value} onOpen={onOpen} />
        </>
      ) : (
        <LoadedProblem loaded={members} refusedText={t('members.refused')} />
      )}
    </section>
  );
}

/**
 * The organization: its name, members, invitations, leaving it and asking to close it (docs/API.md
 * §6; design PD-159). Every action is offered to every member and refused in words (FR-6), except
 * what needs a row only an owner can read.
 */
export function OrganizationPage({ data }: { data: OrganizationData }) {
  const { t } = useTranslation('organization');
  const { current, members, invites } = data;
  const { page, status, statusRef } = usePageStatus(data);
  const { remember, restoreFocus } = useDialogOpener();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  // Reading the page again starts the list over, so what opened a dialog may be gone when it closes.
  const returnFocus = (closing: Event) => {
    restoreFocus(closing);
    if (document.activeElement === document.body) page.focusStatus(closing);
  };
  const openMember: OpenMemberDialog = (kind, member, revision, opener) => {
    remember(opener);
    setDialog({ kind, member, revision });
  };
  const openWithdraw = (invite: OrganizationInvite, opener: HTMLElement) => {
    remember(opener);
    setDialog({ kind: 'withdraw', invite });
  };
  return (
    <section className="flex flex-col gap-8">
      <Link
        to={APP_PATHS.app}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {current.kind === 'ready' ? (
        <>
          <NameForm key={current.value.name} name={current.value.name} page={page} />
          <Members members={members} onOpen={openMember} />
          <Invites invites={invites} now={data.now} page={page} onWithdraw={openWithdraw} />
          <p className="text-muted-foreground m-0 text-sm">{t('datesNote')}</p>
          <Leaving
            revision={current.value.accessRevision}
            page={page}
            remember={remember}
            restoreFocus={restoreFocus}
          />
        </>
      ) : (
        <LoadedProblem loaded={current} refusedText={t('refused')} />
      )}
      <CurrentDialog
        dialog={dialog}
        members={members}
        page={page}
        onClose={() => setDialog(null)}
        restoreFocus={returnFocus}
      />
    </section>
  );
}
