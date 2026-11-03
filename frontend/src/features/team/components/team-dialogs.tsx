import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { PageActions } from '@/ui/app-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/kit/alert-dialog';
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

interface DialogContext {
  eventId: string;
  page: PageActions;
  onClose: () => void;
  /** Back to what opened the dialog, when nothing was done. */
  restoreFocus: (closing: Event) => void;
}

/**
 * One press inside a dialog. It can't be dismissed while the request runs, so a refusal always has
 * somewhere to show, and a late answer can't close the next dialog.
 */
function useDialogAction({ page, onClose, restoreFocus }: DialogContext) {
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<TeamRefusal | null>(null);
  const isDone = useRef(false);
  /** After an action, to the status line; otherwise back to what opened the dialog. */
  const onCloseAutoFocus = (closing: Event) =>
    isDone.current ? page.focusStatus(closing) : restoreFocus(closing);
  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen && !isBusy) onClose();
  };
  const run = async (action: () => Promise<void>, message: string) => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await action();
      await page.done(message);
      isDone.current = true;
      onClose();
    } catch (error) {
      const found = refusalOf(error);
      setRefusal(found);
      setIsBusy(false);
      if (found.isStale) page.reload();
    }
  };
  return { isBusy, refusal, run, onCloseAutoFocus, onOpenChange };
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
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(context);
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

interface AskFirstProps {
  onOpenChange: (isOpen: boolean) => void;
  onCloseAutoFocus: (closing: Event) => void;
  title: string;
  body: string;
  confirmLabel: string;
  isBusy: boolean;
  refusal: TeamRefusal | null;
  onConfirm: () => void;
}

function AskFirst({
  onOpenChange,
  onCloseAutoFocus,
  title,
  body,
  confirmLabel,
  isBusy,
  refusal,
  onConfirm,
}: AskFirstProps) {
  const { t } = useTranslation('team');
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {refusal ? <TeamProblem refusal={refusal} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{t('dialog.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isBusy} onClick={onConfirm}>
            {isBusy ? t('dialog.saving') : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Taking someone off the team asks first: they are locked out at once. */
export function RemoveMemberDialog({ member, ...context }: DialogContext & { member: TeamMember }) {
  const { t } = useTranslation('team');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(context);
  return (
    <AskFirst
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('remove.title', { name: member.name })}
      body={t('remove.body')}
      confirmLabel={t('remove.confirm')}
      isBusy={isBusy}
      refusal={refusal}
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
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(context);
  return (
    <AskFirst
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('withdraw.title', { email: invite.email })}
      body={t('withdraw.body')}
      confirmLabel={t('withdraw.confirm')}
      isBusy={isBusy}
      refusal={refusal}
      onConfirm={() =>
        void run(
          () => withdrawInvite(browserSession().api, context.eventId, invite.email),
          t('status.withdrawn', { email: invite.email }),
        )
      }
    />
  );
}
