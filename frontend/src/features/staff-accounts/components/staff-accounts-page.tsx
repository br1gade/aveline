import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LoadedProblem } from '@/features/sending';
import { APP_PATHS } from '@/route-paths';
import {
  StatusLine,
  useDialogOpener,
  usePageStatus,
  WRAPPING_BUTTON,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { StaffAccountsData } from '../load';
import { STAFF_LIST_LIMIT, type StaffAccount } from '../types';
import { GrantForm } from './grant-form';
import { ChangeStaffRoleDialog, RemoveStaffDialog } from './staff-dialogs';

interface OpenDialog {
  kind: 'change' | 'remove';
  account: StaffAccount;
}
type OpenHandler = (dialog: OpenDialog, opener: HTMLElement) => void;

/** One of the staff. The admin's own row has nothing to press: the API refuses a change to it. */
function StaffRow({
  account,
  isSelf,
  onOpen,
}: {
  account: StaffAccount;
  isSelf: boolean;
  onOpen: OpenHandler;
}) {
  const { t } = useTranslation('staff-accounts');
  const forName = (action: string) => t('row.actionFor', { action, name: account.name });
  const change = account.role === 'ADMIN' ? t('row.makeSupport') : t('row.makeAdmin');
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium break-words">
          {account.name}
          {isSelf ? (
            <span className="text-muted-foreground font-normal"> · {t('list.you')}</span>
          ) : null}
        </span>
        <span className="text-muted-foreground text-sm break-all">{account.email}</span>
      </div>
      <p className="m-0 text-sm">{t(`role.${account.role}.name`)}</p>
      {isSelf ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-label={forName(change)}
            onClick={(click) => onOpen({ kind: 'change', account }, click.currentTarget)}
          >
            {change}
          </Button>
          <Button
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-label={forName(t('row.remove'))}
            onClick={(click) => onOpen({ kind: 'remove', account }, click.currentTarget)}
          >
            {t('row.remove')}
          </Button>
        </div>
      )}
    </li>
  );
}

function StaffList({
  staff,
  selfId,
  onOpen,
}: {
  staff: StaffAccount[];
  selfId: string | null;
  onOpen: OpenHandler;
}) {
  const { t } = useTranslation('staff-accounts');
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('list.title')}
      </h2>
      {staff.length === 0 ? (
        <p className="m-0">{t('list.none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {staff.map((account) => (
            <StaffRow
              key={account.userId}
              account={account}
              isSelf={account.userId === selfId}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
      {staff.length >= STAFF_LIST_LIMIT ? (
        <p className="text-muted-foreground m-0 text-sm">
          {t('list.limit', { count: STAFF_LIST_LIMIT })}
        </p>
      ) : null}
    </section>
  );
}

function CurrentDialog({
  dialog,
  ...context
}: {
  dialog: OpenDialog | null;
  page: PageActions;
  onClose: () => void;
  restoreFocus: (closing: Event) => void;
}) {
  if (!dialog) return null;
  return dialog.kind === 'change' ? (
    <ChangeStaffRoleDialog {...context} account={dialog.account} />
  ) : (
    <RemoveStaffDialog {...context} account={dialog.account} />
  );
}

/**
 * Aveline's staff, for an administrator (docs/API.md, "Aveline staff accounts"; design PD-200).
 * Anyone else is told whose page it is, and offered nothing.
 */
export function StaffAccountsPage({ data }: { data: StaffAccountsData }) {
  const { t } = useTranslation('staff-accounts');
  const { page, status, statusRef } = usePageStatus(data);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const open: OpenHandler = (next, opener) => {
    remember(opener);
    setDialog(next);
  };
  const { staff } = data;
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={APP_PATHS.staff}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {staff.kind === 'ready' ? (
        <>
          <StaffList staff={staff.value} selfId={data.selfId} onOpen={open} />
          <GrantForm page={page} />
        </>
      ) : (
        <LoadedProblem loaded={staff} refusedText={t('list.refused')} />
      )}
      <CurrentDialog
        dialog={dialog}
        page={page}
        onClose={() => setDialog(null)}
        restoreFocus={restoreFocus}
      />
    </section>
  );
}
