import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { browserSession } from '@/api/session';
import { APP_PATHS } from '@/route-paths';
import {
  AskFirstDialog,
  useDialogAction,
  WordedRefusal,
  WRAPPING_BUTTON,
  type DialogContext,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';

import { archiveEvent, deleteEvent, unarchiveEvent } from '../api';
import { eventPath } from '../paths';
import { isArchived, isDeletable, putAwayRefusalOf, type PutAwayRefusal } from '../put-away';
import type { EventDetail } from '../types';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
function PutAwayProblem({ refusal }: { refusal: PutAwayRefusal }) {
  const { t } = useTranslation('events');
  return (
    <WordedRefusal
      message={t(`putAway.refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

type DialogProps = DialogContext & { event: EventDetail };

/** Archiving asks first, saying what stops; nothing is deleted. */
export function ArchiveDialog({ event, ...context }: DialogProps) {
  const { t } = useTranslation('events');
  const action = useDialogAction(context, putAwayRefusalOf);
  return (
    <AskFirstDialog
      onOpenChange={action.onOpenChange}
      onCloseAutoFocus={action.onCloseAutoFocus}
      title={t('putAway.archiveTitle', { title: event.title })}
      body={t('putAway.archiveBody')}
      confirmLabel={t('putAway.archiveConfirm')}
      isBusy={action.isBusy}
      problem={action.refusal ? <PutAwayProblem refusal={action.refusal} /> : null}
      onConfirm={() =>
        void action.run(() => archiveEvent(browserSession().api, event.id), t('putAway.archived'))
      }
    />
  );
}

/**
 * Deleting is never one mistaken tap away (design PD-112): it opens a dialog whose Cancel has the
 * focus, and the Delete button stays unavailable until a box saying what goes is ticked. After it,
 * the event's own pages no longer exist, so the host lands on their events with the status line.
 */
export function DeleteDialog({ event, ...context }: DialogProps) {
  const { t } = useTranslation('events');
  const navigate = useNavigate();
  const id = useId();
  const [isUnderstood, setIsUnderstood] = useState(false);
  const page: PageActions = {
    ...context.page,
    done: async (message) => {
      await navigate(APP_PATHS.app, { state: { status: message } });
    },
  };
  const action = useDialogAction({ ...context, page }, putAwayRefusalOf);
  return (
    <AskFirstDialog
      onOpenChange={action.onOpenChange}
      onCloseAutoFocus={action.onCloseAutoFocus}
      title={t('putAway.deleteTitle', { title: event.title })}
      body={t('putAway.deleteBody')}
      confirmLabel={t('putAway.deleteConfirm')}
      isBusy={action.isBusy}
      isConfirmable={isUnderstood}
      problem={action.refusal ? <PutAwayProblem refusal={action.refusal} /> : null}
      onConfirm={() =>
        void action.run(
          () => deleteEvent(browserSession().api, event.id),
          t('putAway.deleted', { title: event.title }),
        )
      }
    >
      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id={id}
          className="mt-1"
          checked={isUnderstood}
          disabled={action.isBusy}
          onCheckedChange={(checked) => setIsUnderstood(checked === true)}
        />
        <Label htmlFor={id} className="leading-snug font-normal">
          {t('putAway.deleteUnderstood')}
        </Label>
      </div>
    </AskFirstDialog>
  );
}

/** Bringing an archived event back is safe, so it goes at once and says what stays closed. */
function useBringBack(event: EventDetail, page: PageActions) {
  const { t } = useTranslation('events');
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<PutAwayRefusal | null>(null);
  const bringBack = async () => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await unarchiveEvent(browserSession().api, event.id);
      await page.done(t('putAway.broughtBack'));
    } catch (error) {
      const found = putAwayRefusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { isBusy, refusal, bringBack };
}

export type PutAwayDialog = 'archive' | 'delete';

interface PutAwaySectionProps {
  event: EventDetail;
  page: PageActions;
  onOpen: (dialog: PutAwayDialog, opener: HTMLElement) => void;
}

/**
 * Archiving, bringing back and deleting, last on the overview (design PD-112). Every role is
 * offered them, and a 403 is worded (FR-6); only deleting a published event, which the backend
 * always refuses, is not offered, with a line saying why.
 */
export function PutAwaySection({ event, page, onOpen }: PutAwaySectionProps) {
  const { t } = useTranslation('events');
  const headingId = useId();
  const back = useBringBack(event, page);
  const isPutAway = isArchived(event);
  return (
    <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('putAway.title')}
      </h2>
      <p className="m-0">{t(isPutAway ? 'putAway.archivedLead' : 'putAway.archiveLead')}</p>
      {back.refusal ? <PutAwayProblem refusal={back.refusal} /> : null}
      {isPutAway ? (
        <Button
          variant="outline"
          className={`self-start ${WRAPPING_BUTTON}`}
          disabled={back.isBusy}
          onClick={() => void back.bringBack()}
        >
          {back.isBusy ? t('putAway.bringingBack') : t('putAway.bringBack')}
        </Button>
      ) : (
        <Button
          variant="outline"
          className={`self-start ${WRAPPING_BUTTON}`}
          onClick={(click) => onOpen('archive', click.currentTarget)}
        >
          {t('putAway.archive')}
        </Button>
      )}
      <p className="m-0">{t(isDeletable(event) ? 'putAway.deleteLead' : 'putAway.notDeletable')}</p>
      {isDeletable(event) ? (
        <Button
          variant="outline"
          className={`text-destructive self-start ${WRAPPING_BUTTON}`}
          onClick={(click) => onOpen('delete', click.currentTarget)}
        >
          {t('putAway.delete')}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * Said on an archived event's pages (design PD-113): on its overview, what stopped and that the rest
 * still works; on the invitation's and the designer's, what they refuse until it is brought back.
 */
export function ArchivedNotice({
  event,
  where,
}: {
  event: Pick<EventDetail, 'id' | 'status'>;
  where: 'overview' | 'invitation' | 'design';
}) {
  const { t } = useTranslation('events');
  if (!isArchived(event)) return null;
  return (
    <div className="border-border flex max-w-[40rem] flex-col items-start border-l-2 pl-3">
      <p className="m-0">{t(`putAway.archivedNotice.${where}`)}</p>
      {where === 'overview' ? null : (
        <Link
          to={eventPath(event.id)}
          className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline"
        >
          {t('putAway.bringBackThere')}
        </Link>
      )}
    </div>
  );
}
