import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AskFirstDialog, useDialogAction, type DialogContext } from '@/ui/app-form';

import { grantStaff, revokeStaff } from '../api';
import { revokeRefusalOf, staffRefusalOf } from '../refusals';
import { otherRole, type StaffAccount } from '../types';
import { StaffProblem } from './shared';

/**
 * Giving someone the other role asks first: an admin can do everything, and support loses billing
 * and staff. It applies on their next request (design PD-200).
 */
export function ChangeStaffRoleDialog({
  account,
  ...context
}: DialogContext & { account: StaffAccount }) {
  const { t } = useTranslation('staff-accounts');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(
    context,
    staffRefusalOf,
  );
  const role = otherRole(account.role);
  const roleName = t(`role.${role}.name`);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('change.title', { name: account.name, role: roleName })}
      body={t(`change.${role}`)}
      confirmLabel={role === 'ADMIN' ? t('row.makeAdmin') : t('row.makeSupport')}
      isBusy={isBusy}
      problem={refusal ? <StaffProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          async () => {
            await grantStaff(browserSession().api, { email: account.email, role });
          },
          t('status.granted', { name: account.name, role: roleName }),
        )
      }
    />
  );
}

/** Removing someone from the staff asks first: the staff pages close to them on their next request. */
export function RemoveStaffDialog({
  account,
  ...context
}: DialogContext & { account: StaffAccount }) {
  const { t } = useTranslation('staff-accounts');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(
    context,
    revokeRefusalOf,
  );
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('remove.title', { name: account.name })}
      body={t('remove.body')}
      confirmLabel={t('remove.confirm')}
      isBusy={isBusy}
      problem={refusal ? <StaffProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(
          () => revokeStaff(browserSession().api, account.userId),
          t('status.removed', { name: account.name }),
        )
      }
    />
  );
}
