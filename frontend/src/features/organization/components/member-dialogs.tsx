import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { forgetSettledOrganization } from '@/features/account';
import {
  AskFirstDialog,
  useDialogAction,
  useLeaveGuardWhen,
  type DialogContext as PageDialogContext,
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

import { changeMemberRole, makeOwner, removeMember, withdrawInvite } from '../api';
import { roleOf } from '../read';
import { refusalOf, type OrganizationRefusal } from '../refusals';
import type { OrganizationInvite, OrganizationMember } from '../types';
import { RoleField } from './role-field';
import { OrganizationProblem, useRoleName } from './shared';

interface MemberDialogProps extends PageDialogContext {
  member: OrganizationMember;
  /** What the list read: a write says it, so two people's changes can't cross. */
  revision: number;
}

function useOrganizationAction(context: PageDialogContext) {
  return useDialogAction<OrganizationRefusal>(context, refusalOf);
}

/** The caller changing their own role is warned they may lose this page (FR-121). */
export function ChangeRoleDialog({ member, revision, ...context }: MemberDialogProps) {
  const { t } = useTranslation('organization');
  const roleName = useRoleName();
  const [role, setRole] = useState(member.role);
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useOrganizationAction(context);
  useLeaveGuardWhen(!isBusy && role !== member.role);
  const change = { userId: member.userId, expectedRevision: revision };
  const canSave = role !== null && role !== member.role;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('changeRole.title', { name: member.name })}</DialogTitle>
          <DialogDescription>
            {t('changeRole.body')}
            {member.isCurrentUser ? ` ${t('changeRole.self')}` : ''}
          </DialogDescription>
        </DialogHeader>
        {refusal ? <OrganizationProblem refusal={refusal} /> : null}
        <RoleField
          label={t('changeRole.label')}
          chosen={role}
          value={role ?? ''}
          onChange={(event) => setRole(roleOf(event.target.value))}
        />
        <DialogFooter>
          <Button variant="ghost" disabled={isBusy} onClick={context.onClose}>
            {t('changeRole.cancel')}
          </Button>
          <Button
            disabled={isBusy || !canSave}
            onClick={() => {
              if (!role) return;
              void run(
                () => changeMemberRole(browserSession().api, change, role),
                t('status.roleChanged', { name: member.name, role: roleName(role) }),
              );
            }}
          >
            {isBusy ? t('changeRole.saving') : t('changeRole.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveMemberDialog({ member, revision, ...context }: MemberDialogProps) {
  const { t } = useTranslation('organization');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useOrganizationAction(context);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('remove.title', { name: member.name })}
      body={member.isCurrentUser ? `${t('remove.body')} ${t('remove.self')}` : t('remove.body')}
      confirmLabel={t('remove.confirm')}
      isBusy={isBusy}
      problem={refusal ? <OrganizationProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          async () => {
            await removeMember(browserSession().api, {
              userId: member.userId,
              expectedRevision: revision,
            });
            // Removing themselves ends their place here, so the tab's choice goes (FR-121).
            if (member.isCurrentUser) forgetSettledOrganization();
          },
          t('status.removed', { name: member.name }),
        )
      }
    />
  );
}

export function MakeOwnerDialog({ member, revision, ...context }: MemberDialogProps) {
  const { t } = useTranslation('organization');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useOrganizationAction(context);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('owner.title', { name: member.name })}
      body={t('owner.body')}
      confirmLabel={t('owner.confirm')}
      isBusy={isBusy}
      problem={refusal ? <OrganizationProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          () =>
            makeOwner(browserSession().api, { userId: member.userId, expectedRevision: revision }),
          t('status.madeOwner', { name: member.name }),
        )
      }
    />
  );
}

export function WithdrawInviteDialog({
  invite,
  ...context
}: PageDialogContext & { invite: OrganizationInvite }) {
  const { t } = useTranslation('organization');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useOrganizationAction(context);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('invites.withdrawTitle', { email: invite.email })}
      body={t('invites.withdrawBody')}
      confirmLabel={t('invites.withdraw')}
      isBusy={isBusy}
      problem={refusal ? <OrganizationProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          () => withdrawInvite(browserSession().api, invite.email),
          t('status.withdrawn', { email: invite.email }),
        )
      }
    />
  );
}
