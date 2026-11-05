import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { isApiError } from '@/api/errors';
import { browserSession, organizationChoice } from '@/api/session';
import { forgetSettledOrganization } from '@/features/account';
import { APP_PATHS } from '@/route-paths';
import {
  AskFirstDialog,
  LEAVE_UNASKED,
  useDialogAction,
  WRAPPING_BUTTON,
  type DialogContext,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { askToClose, leaveOrganization } from '../api';
import { refusalOf, type OrganizationRefusal } from '../refusals';
import { OrganizationProblem } from './shared';

/** Asking first. Once gone nothing here can be read, so it goes to the events, asking nothing. */
function LeaveDialog({ revision, page, onClose, restoreFocus }: LeaveDialogProps) {
  const { t } = useTranslation('organization');
  const navigate = useNavigate();
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<OrganizationRefusal | null>(null);
  const leave = async () => {
    setIsBusy(true);
    setRefusal(null);
    try {
      await leaveOrganization(browserSession().api, revision);
      organizationChoice.clear();
      forgetSettledOrganization();
      await navigate(APP_PATHS.app, { replace: true, state: LEAVE_UNASKED });
    } catch (error) {
      setIsBusy(false);
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  return (
    <AskFirstDialog
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      onCloseAutoFocus={restoreFocus}
      title={t('leave.askTitle')}
      body={t('leave.askBody')}
      confirmLabel={t('leave.confirm')}
      isBusy={isBusy}
      problem={refusal ? <OrganizationProblem refusal={refusal} /> : null}
      onConfirm={() => void leave()}
    />
  );
}

interface LeaveDialogProps {
  revision: number;
  page: PageActions;
  onClose: () => void;
  restoreFocus: (closing: Event) => void;
}

/**
 * The route names no permission, so its service refuses anyone without one as if they weren't in the
 * organization. This page has just read it, so that means they aren't an owner (FR-124).
 */
function closeRefusalOf(error: unknown): OrganizationRefusal {
  return isApiError(error) && error.code === 'ORGANIZATION_ACCESS_DENIED'
    ? { kind: 'onlyOwner' }
    : refusalOf(error);
}

function CloseDialog({ revision, ...context }: DialogContext & { revision: number }) {
  const { t } = useTranslation('organization');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } =
    useDialogAction<OrganizationRefusal>(context, closeRefusalOf);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('close.askTitle')}
      body={t('close.askBody')}
      confirmLabel={t('close.confirm')}
      isBusy={isBusy}
      problem={refusal ? <OrganizationProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(() => askToClose(browserSession().api, revision), t('status.closeAsked'))
      }
    />
  );
}

interface LeavingProps {
  revision: number;
  page: PageActions;
  remember: (opener: HTMLElement) => void;
  restoreFocus: (closing: Event) => void;
}

/** Leaving is any member's; asking to close is an owner's, and worded for anyone else (FR-6). */
export function Leaving({ revision, page, remember, restoreFocus }: LeavingProps) {
  const { t } = useTranslation('organization');
  const leaveId = useId();
  const closeId = useId();
  const [dialog, setDialog] = useState<'leave' | 'close' | null>(null);
  const onClose = () => setDialog(null);
  const open = (next: 'leave' | 'close', opener: HTMLElement) => {
    remember(opener);
    setDialog(next);
  };
  return (
    <>
      <section aria-labelledby={leaveId} className="flex max-w-[40rem] flex-col gap-3">
        <h2 id={leaveId} className="m-0 text-lg font-medium">
          {t('leave.title')}
        </h2>
        <p className="m-0">{t('leave.lead')}</p>
        <Button
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          onClick={(click) => open('leave', click.currentTarget)}
        >
          {t('leave.open')}
        </Button>
      </section>
      <section aria-labelledby={closeId} className="flex max-w-[40rem] flex-col gap-3">
        <h2 id={closeId} className="m-0 text-lg font-medium">
          {t('close.title')}
        </h2>
        <p className="m-0">{t('close.lead')}</p>
        <Button
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          onClick={(click) => open('close', click.currentTarget)}
        >
          {t('close.open')}
        </Button>
      </section>
      {dialog === 'leave' ? (
        <LeaveDialog
          revision={revision}
          page={page}
          onClose={onClose}
          restoreFocus={restoreFocus}
        />
      ) : null}
      {dialog === 'close' ? (
        <CloseDialog
          revision={revision}
          page={page}
          onClose={onClose}
          restoreFocus={restoreFocus}
        />
      ) : null}
    </>
  );
}
