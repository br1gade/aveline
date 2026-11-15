import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { InvitationStatus } from '@/features/events';
import {
  AskFirstDialog,
  useDialogAction,
  useDialogOpener,
  type DialogContext,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { closeInvitation, reopenInvitation } from '../api';
import { refusalOf, type Refusal } from '../refusals';
import { RefusalAlert } from './refusal-alert';

interface RepliesProps {
  slug: string;
  status: Extract<InvitationStatus, 'PUBLISHED' | 'CLOSED'>;
  /** Past its time: reopening succeeds, but guests still cannot open it (docs/API.md §6). */
  isExpired: boolean;
  page: PageActions;
}

/** Stopping replies asks first: every guest meets it at once (design PD-47, audit F-20). */
function StopRepliesDialog({ slug, ...context }: DialogContext & { slug: string }) {
  const { t } = useTranslation('sending');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(
    context,
    refusalOf,
  );
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('replies.stop.title')}
      body={t('replies.stop.body')}
      confirmLabel={t('replies.stop.confirm')}
      isBusy={isBusy}
      problem={refusal ? <RefusalAlert refusal={refusal} action="close" /> : null}
      onConfirm={() =>
        void run(async () => {
          await closeInvitation(browserSession().api, slug);
        }, t('status.closed'))
      }
    />
  );
}

/**
 * Stopping replies and taking them again (docs/API.md §6). Stopping asks first, as every guest
 * meets it at once; taking them again does not (design PD-47, audit F-20). The words beside the
 * button say what each does.
 */
export function RepliesPanel({ slug, status, isExpired, page }: RepliesProps) {
  const { t } = useTranslation('sending');
  const [isMoving, setIsMoving] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const isOpen = status === 'PUBLISHED';
  const action = isOpen ? 'close' : 'reopen';

  const reopen = async () => {
    setRefusal(null);
    setIsMoving(true);
    try {
      await reopenInvitation(browserSession().api, slug);
      await page.done(t('status.reopened'));
    } catch (error) {
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setIsMoving(false);
    }
  };
  const press = (opener: HTMLElement) => {
    if (!isOpen) {
      void reopen();
      return;
    }
    remember(opener);
    setIsAsking(true);
  };

  return (
    <section aria-labelledby="replies-title" className="flex max-w-[40rem] flex-col gap-3">
      <h2 id="replies-title" className="m-0 text-lg font-medium">
        {t('replies.title')}
      </h2>
      <p className="m-0">{t(isOpen ? 'replies.open' : 'replies.closed')}</p>
      {isExpired ? (
        <p className="text-muted-foreground m-0 text-sm">{t('replies.expired')}</p>
      ) : null}
      {refusal ? <RefusalAlert refusal={refusal} action={action} /> : null}
      <Button
        variant="outline"
        className="self-start"
        disabled={isMoving}
        onClick={(click) => press(click.currentTarget)}
      >
        {t(isOpen ? 'replies.close' : 'replies.reopen')}
      </Button>
      {isAsking ? (
        <StopRepliesDialog
          slug={slug}
          page={page}
          onClose={() => setIsAsking(false)}
          restoreFocus={restoreFocus}
        />
      ) : null}
    </section>
  );
}
