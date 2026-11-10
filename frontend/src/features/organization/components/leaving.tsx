import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { isApiError } from '@/api/errors';
import { browserSession, organizationChoice } from '@/api/session';
import { forgetSettledOrganization } from '@/features/account';
import { useCan } from '@/features/permissions';
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
import type { ClosureReview } from '../types';
import { OrganizationProblem, useOrganizationDay } from './shared';

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
 * The route needs `member:manage` and its service an active owner (FR-124): the guard's plain 403
 * (`FORBIDDEN`) and the service's own both mean only an owner may ask, and so does its 404 for
 * staff, who hold the permission without being a member. `ORGANIZATION_ACCESS_DENIED` says the
 * caller isn't in the organization at all.
 */
function closeRefusalOf(error: unknown): OrganizationRefusal {
  const isOwnersOnly =
    isApiError(error) &&
    ((error.status === 403 && error.code === 'FORBIDDEN') || error.status === 404);
  return isOwnersOnly ? { kind: 'onlyOwner' } : refusalOf(error);
}

/**
 * Where a request to close stands (FR-122), with the day staff answered. A waiting request names no
 * day: asking again after an answer keeps the first request's `openedAt` (FR-148).
 */
function ClosureState({ closure }: { closure: ClosureReview }) {
  const { t } = useTranslation('organization');
  const day = useOrganizationDay();
  const date = closure.resolvedAt ? day(closure.resolvedAt) : '';
  return <p className="m-0 font-medium">{t(`close.${closure.state}`, { date })}</p>;
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
  closure: ClosureReview | null;
  page: PageActions;
  remember: (opener: HTMLElement) => void;
  restoreFocus: (closing: Event) => void;
}

/**
 * Asking to close is an owner's: offered with `member:manage` (FR-6), not while a request waits, and
 * again once staff have answered one (FR-122).
 */
function Closing({
  closure,
  onAsk,
}: {
  closure: ClosureReview | null;
  onAsk: (opener: HTMLElement) => void;
}) {
  const { t } = useTranslation('organization');
  const headingId = useId();
  const canAsk = useCan('member:manage') && closure?.state !== 'waiting';
  return (
    <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('close.title')}
      </h2>
      <p className="m-0">{t('close.lead')}</p>
      {closure ? <ClosureState closure={closure} /> : null}
      {canAsk ? (
        <Button
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          onClick={(click) => onAsk(click.currentTarget)}
        >
          {t('close.open')}
        </Button>
      ) : null}
    </section>
  );
}

/** Leaving is any member's; asking to close, an owner's. */
export function Leaving({ revision, closure, page, remember, restoreFocus }: LeavingProps) {
  const { t } = useTranslation('organization');
  const leaveId = useId();
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
      <Closing closure={closure} onAsk={(opener) => open('close', opener)} />
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
