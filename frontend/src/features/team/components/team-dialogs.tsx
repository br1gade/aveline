import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AskFirstDialog,
  useDialogAction,
  type DialogContext as PageDialogContext,
  useLeaveGuardWhen,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import { changeRole, removeMember, withdrawInvite } from '../api';
import { refusalOf, type TeamRefusal } from '../refusals';
import type { EventRole, OpenInvite, TeamMember } from '../types';
import { RoleChoices, TeamProblem, useRoleName } from './shared';

interface DialogContext extends PageDialogContext {
  eventId: string;
}

function useTeamDialogAction(context: DialogContext) {
  return useDialogAction<TeamRefusal>(context, refusalOf);
}

/**
 * Changing someone's role (design PD-99). It applies on their next request. Nothing says who the
 * caller is (FR-88), so the words warn anyone that an owner changing their own role loses this page.
 */
export function ChangeRoleDialog({ member, ...context }: DialogContext & { member: TeamMember }) {
  const { t } = useTranslation('team');
  const roleName = useRoleName();
  const labelId = useId();
  const [role, setRole] = useState<EventRole | null>(member.role);
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useTeamDialogAction(context);
  useLeaveGuardWhen(!isBusy && role !== member.role);
  const save = (chosen: EventRole) =>
    run(
      () => changeRole(browserSession().api, context.eventId, member.userId, chosen),
      t('status.roleChanged', { name: member.name, role: roleName(chosen) }),
    );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('change.title', { name: member.name })}</DialogTitle>
          <DialogDescription>{t('change.body')}</DialogDescription>
        </DialogHeader>
        {refusal ? <TeamProblem refusal={refusal} /> : null}
        <p id={labelId} className="m-0 text-sm font-medium">
          {t('invite.role')}
        </p>
        <RoleChoices
          idPrefix="change-role"
          labelledBy={labelId}
          value={role}
          onChange={setRole}
          mark={{ role: member.role, words: t('change.current') }}
        />
        <DialogFooter>
          <Button variant="ghost" disabled={isBusy} onClick={context.onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            disabled={isBusy || role === null || role === member.role}
            onClick={() => {
              if (role) void save(role);
            }}
          >
            {isBusy ? t('dialog.saving') : t('change.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Taking someone off the team asks first: they are locked out at once. */
export function RemoveMemberDialog({ member, ...context }: DialogContext & { member: TeamMember }) {
  const { t } = useTranslation('team');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useTeamDialogAction(context);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('remove.title', { name: member.name })}
      body={t('remove.body')}
      confirmLabel={t('remove.confirm')}
      isBusy={isBusy}
      problem={refusal ? <TeamProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          () => removeMember(browserSession().api, context.eventId, member.userId),
          t('status.removed', { name: member.name }),
        )
      }
    />
  );
}

/** Withdrawing asks first: the emailed link stops working, and only a new invitation brings it back. */
export function WithdrawInviteDialog({
  invite,
  ...context
}: DialogContext & { invite: OpenInvite }) {
  const { t } = useTranslation('team');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useTeamDialogAction(context);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('withdraw.title', { email: invite.email })}
      body={t('withdraw.body')}
      confirmLabel={t('withdraw.confirm')}
      isBusy={isBusy}
      problem={refusal ? <TeamProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          () => withdrawInvite(browserSession().api, context.eventId, invite.email),
          t('status.withdrawn', { email: invite.email }),
        )
      }
    />
  );
}
