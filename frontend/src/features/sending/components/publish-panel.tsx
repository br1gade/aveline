import { useRef, useState } from 'react';
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

import { publishInvitation } from '../api';
import { isReadinessRefusal, readBlockers, type Blocker } from '../blockers';
import type { Loaded } from '../load';
import { refusalOf, type Refusal } from '../refusals';
import type { DesignStatus } from '../types';
import { BlockerList } from './blocker-list';
import { LoadedProblem } from './loaded-problem';
import { RefusalAlert } from './refusal-alert';

interface PublishProps {
  eventId: string;
  slug: string;
  draft: Loaded<DesignStatus>;
  page: PageActions;
}

interface PublishActions {
  slug: string;
  page: PageActions;
  onBlocked: (blockers: Blocker[]) => void;
}

/**
 * The press itself. A refusal listing blockers replaces the list the page loaded: it is the
 * server's word now. Any other refusal is a state that changed meanwhile, and the page reloads.
 */
function usePublish({ slug, page, onBlocked }: PublishActions) {
  const { t } = useTranslation('sending');
  const [isPublishing, setIsPublishing] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const isDone = useRef(false);

  const publish = async () => {
    setRefusal(null);
    setIsPublishing(true);
    try {
      await publishInvitation(browserSession().api, slug);
      isDone.current = true;
      await page.done(t('status.published'));
    } catch (error) {
      const found = refusalOf(error);
      const refusedBlockers = readBlockers(found.messages);
      if (isReadinessRefusal(refusedBlockers)) {
        setBlockers(refusedBlockers);
        onBlocked(refusedBlockers);
      } else {
        setRefusal(found);
        if (found.isStale) page.reload();
      }
      setIsPublishing(false);
    }
  };
  return { publish, isPublishing, refusal, blockers, isDone };
}

/**
 * Publishing asks first, and says there is no way back to draft (design PD-47). The press is a
 * plain button, so the dialog stays open while the request runs and can show a refusal.
 */
function PublishDialog({
  eventId,
  onClose,
  ...actions
}: PublishActions & { eventId: string; onClose: () => void }) {
  const { t } = useTranslation('sending');
  const { publish, isPublishing, refusal, blockers, isDone } = usePublish(actions);
  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent
        onCloseAutoFocus={(closing) => {
          if (isDone.current) actions.page.focusStatus(closing);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('publish.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('publish.confirmBody')}</AlertDialogDescription>
          <p className="m-0 text-sm font-medium">{t('publish.noWayBack')}</p>
        </AlertDialogHeader>
        {blockers ? (
          <div role="alert" className="flex flex-col gap-2 text-sm">
            <p className="m-0 font-medium">{t('publish.blockedTitle')}</p>
            <BlockerList blockers={blockers} eventId={eventId} />
          </div>
        ) : null}
        {refusal ? <RefusalAlert refusal={refusal} action="publish" /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('publish.cancel')}</AlertDialogCancel>
          <Button disabled={isPublishing || blockers !== null} onClick={() => void publish()}>
            {isPublishing ? t('publish.publishing') : t('publish.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The blockers, "nothing in the way", or why they could not be read. */
function Readiness({
  draft,
  blockers,
  eventId,
}: {
  draft: Loaded<DesignStatus> | null;
  blockers: readonly Blocker[];
  eventId: string;
}) {
  const { t } = useTranslation('sending');
  if (draft && draft.kind !== 'ready') {
    return <LoadedProblem loaded={draft} refusedText={t('publish.blockersRefused')} />;
  }
  if (blockers.length === 0) return <p className="m-0">{t('publish.ready')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-medium">{t('publish.blockedTitle')}</p>
      <BlockerList blockers={blockers} eventId={eventId} />
    </div>
  );
}

/** A draft: what still blocks publishing, all at once, and the way to publish (docs/API.md §6). */
export function PublishPanel({ eventId, slug, draft, page }: PublishProps) {
  const { t } = useTranslation('sending');
  const [isOpen, setIsOpen] = useState(false);
  const [refused, setRefused] = useState<Blocker[] | null>(null);
  const blockers =
    refused ?? (draft.kind === 'ready' ? readBlockers(draft.value.publishBlockers) : []);
  const isBlocked = blockers.length > 0;
  return (
    <section aria-labelledby="publish-title" className="flex max-w-[40rem] flex-col gap-3">
      <h2 id="publish-title" className="m-0 text-lg font-medium">
        {t('publish.title')}
      </h2>
      <p className="m-0">{t('publish.lead')}</p>
      <Readiness draft={refused ? null : draft} blockers={blockers} eventId={eventId} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={isBlocked} onClick={() => setIsOpen(true)}>
          {t('publish.button')}
        </Button>
        {isBlocked ? (
          <p className="text-muted-foreground m-0 text-sm">{t('publish.waiting')}</p>
        ) : null}
      </div>
      {isOpen ? (
        <PublishDialog
          slug={slug}
          eventId={eventId}
          page={page}
          onBlocked={setRefused}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </section>
  );
}
