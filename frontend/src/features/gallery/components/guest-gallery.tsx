import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createPublicApi } from '@/api/client';
import type { Problem } from '@/api/problems';
import { readPublicEnv } from '@/config/env';
import type { Invitation } from '@/features/invitation-renderer';
import { Button, Notice, SectionHeading, useNearScreen } from '@/ui';

import { guestPhotoFile, type GalleryLink } from '../api';
import { PHOTO_LIMIT_BYTES, PHOTOS_PER_GUEST } from '../rules';
import { guestSection } from '../status';
import type { PhotoVariant } from '../types';
import { GuestPhotos } from './guest-photos';
import { OwnPhotos } from './own-photos';
import { SharePhotos } from './share-photos';
import { useGuestGallery, type ListState } from './use-guest-gallery';

/** The section's id, so a link can lead to it. */
const GALLERY_SECTION_ID = 'guest-photos';

const MEBIBYTE = 1024 * 1024;

function ProblemNotice({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  const { t } = useTranslation('gallery');
  const words =
    problem.code === 'rate-limited' || problem.code === 'unreachable'
      ? t(`problems.${problem.code}`)
      : t('list.failed');
  const retry = (
    <Button variant="secondary" onClick={onRetry} className="self-start">
      {t('list.retry')}
    </Button>
  );
  return (
    <Notice tone="error" role="alert" action={retry}>
      <p>{words}</p>
      {problem.code === 'server' && problem.requestId ? (
        <p className="text-ink-muted mt-1 text-sm select-all">
          {t('reference', { id: problem.requestId })}
        </p>
      ) : null}
    </Notice>
  );
}

function ListStateLine({ state, onRetry }: { state: ListState; onRetry: () => void }) {
  const { t } = useTranslation('gallery');
  if (state.kind === 'waiting') {
    return (
      <p role="status" className="text-ink-muted m-0 text-sm">
        {t('list.loading')}
      </p>
    );
  }
  if (state.kind === 'closed') {
    return (
      <Notice role="alert">
        <p>{t('list.closed')}</p>
      </Notice>
    );
  }
  return state.kind === 'failed' ? (
    <ProblemNotice problem={state.problem} onRetry={onRetry} />
  ) : null;
}

/** What the section shows; once it has shown something, it stays for the visit (`guestSection`). */
function useGuestSection(isOpen: boolean, gallery: ReturnType<typeof useGuestGallery>) {
  const [wasShown, setWasShown] = useState(false);
  const section = guestSection({
    isOpen,
    wasShown,
    list: gallery.state.kind,
    photoCount: gallery.photos.length,
  });
  if (section !== 'hidden' && !wasShown) setWasShown(true);
  return section;
}

function GalleryIntro({ isSharing }: { isSharing: boolean }) {
  const { t } = useTranslation('gallery');
  if (!isSharing) return <p className="m-0">{t('guest.closedIntro')}</p>;
  return (
    <>
      <p className="m-0">{t('guest.intro')}</p>
      <p className="text-ink-muted m-0 text-sm">
        {t('guest.limits', { limit: PHOTOS_PER_GUEST, size: PHOTO_LIMIT_BYTES / MEBIBYTE })}
      </p>
    </>
  );
}

/**
 * Photos from guests, on a personal link (docs/API.md §11; design PD-63, PD-187): sharing while the
 * hosts allow it, the guest's own photos in each state, and other guests' approved ones. The list is
 * read in the browser once the section nears the screen, so the section's root stays mounted even
 * with nothing to show; every picture is read through the API and shown from memory, so the guest's
 * token never reaches the page (ARCHITECTURE §9).
 */
export function GuestGallery({ invitation, link }: { invitation: Invitation; link: GalleryLink }) {
  const { t } = useTranslation('gallery');
  const { locale } = invitation;
  const api = useMemo(
    () => createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => locale }),
    [locale],
  );
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const gallery = useGuestGallery(api, link, useNearScreen(root));
  const zone = { timeZone: invitation.event.timezone, locale };
  const load = (id: string) => (variant: PhotoVariant, signal: AbortSignal) =>
    guestPhotoFile(api, { ...link, mediaId: id }, variant, signal);
  const own = gallery.photos.filter((photo) => photo.isOwn);
  const others = gallery.photos.filter((photo) => !photo.isOwn);
  const isReady = gallery.state.kind === 'ready';
  const section = useGuestSection(invitation.galleryUploadsEnabled === true, gallery);
  if (section === 'hidden')
    return <div ref={setRoot} id={GALLERY_SECTION_ID} className="absolute" />;
  const isSharing = section === 'sharing';
  return (
    <div ref={setRoot} id={GALLERY_SECTION_ID} className="flex scroll-mt-6 flex-col gap-6">
      <SectionHeading label={t('guest.label')} heading={t('guest.heading')} />
      <GalleryIntro isSharing={isSharing} />
      {isSharing && gallery.state.kind !== 'closed' ? (
        <SharePhotos api={api} link={link} onShared={gallery.shared} />
      ) : null}
      <ListStateLine state={gallery.state} onRetry={gallery.retry} />
      {isReady ? (
        <OwnPhotos photos={own} load={load} zone={zone} onRemove={gallery.remove} />
      ) : null}
      {isReady ? <GuestPhotos photos={others} load={load} /> : null}
      {isReady && gallery.nextCursor ? <MorePhotos gallery={gallery} /> : null}
    </div>
  );
}

function MorePhotos({ gallery }: { gallery: ReturnType<typeof useGuestGallery> }) {
  const { t } = useTranslation('gallery');
  const { more } = gallery;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="secondary"
        onClick={() => void gallery.loadMore()}
        disabled={more === 'loading'}
      >
        {more === 'loading' ? t('list.loadingMore') : t('list.more')}
      </Button>
      {typeof more === 'object' ? (
        <p role="alert" className="text-error m-0 text-sm">
          {more.code === 'rate-limited' ? t('problems.rate-limited') : t('list.moreFailed')}
        </p>
      ) : null}
    </div>
  );
}
