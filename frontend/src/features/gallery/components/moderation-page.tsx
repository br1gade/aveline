import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { browserSession } from '@/api/session';
import { eventPath, type EventDetail } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import { ProblemAlert, StatusLine } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/kit/dialog';

import { eventPhotoFile } from '../api';
import type { ModerationData } from '../load';
import type { EveryPage } from '../pages';
import { PHOTOS_PER_EVENT, PHOTOS_PER_GUEST } from '../rules';
import { isModerationTab, MODERATION_TABS, tabOf, type ModerationTab } from '../status';
import type { GalleryPhoto, PhotoVariant } from '../types';
import { GalleryPicture } from './gallery-picture';
import { ModerationCard, type CardActions } from './moderation-card';
import { RemovePhotoDialog } from './remove-photo-dialog';
import { useModeration } from './use-moderation';

const LINK = 'text-primary self-start underline underline-offset-4 hover:no-underline';
/** Cards drawn at a time in a tab: up to a thousand photos, each read only when near the screen. */
const CARDS_AT_A_TIME = 48;

/** The tab in the address (`?show=`), so a reload or a shared link keeps it. */
function useTab(): [ModerationTab, (tab: ModerationTab) => string] {
  const [params] = useSearchParams();
  const shown = params.get('show');
  const hrefFor = (tab: ModerationTab) => {
    const next = new URLSearchParams(params);
    next.set('show', tab);
    return `?${next.toString()}`;
  };
  return [isModerationTab(shown) ? shown : 'review', hrefFor];
}

function Tabs({ photos }: { photos: readonly GalleryPhoto[] }) {
  const { t } = useTranslation('gallery');
  const [current, hrefFor] = useTab();
  const counts = new Map<ModerationTab, number>();
  for (const photo of photos) counts.set(tabOf(photo), (counts.get(tabOf(photo)) ?? 0) + 1);
  return (
    <nav aria-label={t('host.tabs')}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {MODERATION_TABS.map((tab) => (
          <li key={tab}>
            <Link
              to={hrefFor(tab)}
              replace
              preventScrollReset
              aria-current={tab === current ? 'page' : undefined}
              className="border-border aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground inline-flex min-h-11 items-center border px-4 no-underline"
            >
              {t(`host.tab.${tab}`, { count: counts.get(tab) ?? 0 })}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Limits({ every }: { every: EveryPage<GalleryPhoto> }) {
  const { t } = useTranslation('gallery');
  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-sm">
      <p className="m-0">
        {t('host.count', { count: every.photos.length, limit: PHOTOS_PER_EVENT })}
      </p>
      <p className="m-0">{t('host.limits', { limit: PHOTOS_PER_GUEST })}</p>
      {every.isComplete ? null : <p className="m-0">{t('host.partial')}</p>}
    </div>
  );
}

interface ViewProps {
  photo: GalleryPhoto;
  load: (variant: PhotoVariant, signal: AbortSignal) => Promise<Blob>;
  onClose: () => void;
}

function PhotoDialog({ photo, load, onClose }: ViewProps) {
  const { t } = useTranslation('gallery');
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent className="sm:max-w-3xl">
        <DialogTitle>{photo.caption ?? t('host.alt')}</DialogTitle>
        <GalleryPicture
          id={photo.id}
          variant="display"
          load={load}
          alt={photo.caption ?? t('host.alt')}
          className="mx-auto max-h-[70svh] w-auto max-w-full object-contain"
        />
        <Button variant="outline" onClick={onClose} className="justify-self-end">
          {t('host.close')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function useCardActions() {
  const [viewing, setViewing] = useState<GalleryPhoto | null>(null);
  const [removing, setRemoving] = useState<GalleryPhoto | null>(null);
  return { viewing, setViewing, removing, setRemoving };
}

interface DialogsProps {
  dialogs: ReturnType<typeof useCardActions>;
  load: (id: string) => (variant: PhotoVariant, signal: AbortSignal) => Promise<Blob>;
  moderation: ReturnType<typeof useModeration>;
}

/** The larger view, and the question before a removal, which then puts the focus on the status. */
function BoardDialogs({ dialogs, load, moderation }: DialogsProps) {
  const { viewing, removing } = dialogs;
  return (
    <>
      {viewing ? (
        <PhotoDialog
          photo={viewing}
          load={load(viewing.id)}
          onClose={() => dialogs.setViewing(null)}
        />
      ) : null}
      {removing ? (
        <RemovePhotoDialog
          onConfirm={() => moderation.remove(removing)}
          onClose={() => dialogs.setRemoving(null)}
          onCloseAutoFocus={(closing) => {
            closing.preventDefault();
            if (!moderation.refusal) moderation.statusRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function Board({ event, every }: { event: EventDetail; every: EveryPage<GalleryPhoto> }) {
  const { t, i18n } = useTranslation('gallery');
  const moderation = useModeration(event.id, every.photos);
  const [tab] = useTab();
  const [drawn, setDrawn] = useState(CARDS_AT_A_TIME);
  const dialogs = useCardActions();
  const zone = { timeZone: event.timezone, locale: i18n.language };
  const load = (id: string) => (variant: PhotoVariant, signal: AbortSignal) =>
    eventPhotoFile(browserSession().api, { eventId: event.id, mediaId: id }, variant, signal);
  const inTab = moderation.photos.filter((photo) => tabOf(photo) === tab);
  const actions: CardActions = {
    decide: (photo, decision) => void moderation.decide(photo, decision),
    remove: dialogs.setRemoving,
    view: dialogs.setViewing,
  };
  return (
    <>
      <Limits every={{ ...every, photos: moderation.photos }} />
      {moderation.refusal ? (
        <ProblemAlert
          problem={moderation.refusal}
          refused={(status) => t(status === 403 ? 'host.refusedAction' : 'host.failed')}
        />
      ) : null}
      <StatusLine statusRef={moderation.statusRef}>{moderation.said?.text ?? ''}</StatusLine>
      <Tabs photos={moderation.photos} />
      {inTab.length === 0 ? <p className="m-0">{t(`host.empty.${tab}`)}</p> : null}
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {inTab.slice(0, drawn).map((photo) => (
          <ModerationCard key={photo.id} photo={photo} load={load} zone={zone} actions={actions} />
        ))}
      </ul>
      {inTab.length > drawn ? (
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setDrawn((count) => count + CARDS_AT_A_TIME)}
        >
          {t('host.more')}
        </Button>
      ) : null}
      <BoardDialogs dialogs={dialogs} load={load} moderation={moderation} />
    </>
  );
}

/**
 * Guests' photos, for the hosts (docs/API.md §11; design PD-65): the photos to review, those shown to
 * guests, those not approved, and those still being prepared or failed, each tab in the address.
 * A role without `guest:write` is told so. Every picture is read with the bearer token and shown
 * from memory (ARCHITECTURE §9).
 */
export function GalleryModeration({ data }: { data: ModerationData }) {
  const { t } = useTranslation('gallery');
  const { event, photos } = data;
  return (
    <section className="flex flex-col gap-6">
      <Link to={eventPath(event.id)} className={LINK}>
        {t('host.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('host.title')}</h1>
        <p className="text-muted-foreground m-0 break-words">{event.title}</p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('host.intro')}</p>
      {photos.kind === 'ready' ? (
        <Board event={event} every={photos.value} />
      ) : (
        <LoadedProblem loaded={photos} refusedText={t('host.refused')} />
      )}
    </section>
  );
}
