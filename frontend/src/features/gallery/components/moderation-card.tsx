import { useTranslation } from 'react-i18next';

import { formatEventDay, formatEventTime, type EventZone } from '@/lib/time';
import { Button } from '@/ui/kit/button';

import { failureOf, tabOf } from '../status';
import type { GalleryPhoto, PhotoVariant } from '../types';
import { GalleryPicture } from './gallery-picture';
import type { Decision } from './use-moderation';

/** The kit's buttons never wrap; a long label in Armenian or Russian must, in a narrow card. */
const WRAPPING =
  'h-auto min-h-10 py-2 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11';

export type PhotoLoader = (
  id: string,
) => (variant: PhotoVariant, signal: AbortSignal) => Promise<Blob>;

export interface CardActions {
  decide: (photo: GalleryPhoto, decision: Decision) => void;
  remove: (photo: GalleryPhoto) => void;
  view: (photo: GalleryPhoto) => void;
}

interface CardProps {
  photo: GalleryPhoto;
  load: PhotoLoader;
  zone: EventZone;
  actions: CardActions;
}

/** The decisions a tab offers: approve what waits, hide what shows, approve what was refused. */
function Decisions({ photo, actions }: Pick<CardProps, 'photo' | 'actions'>) {
  const { t } = useTranslation('gallery');
  const tab = tabOf(photo);
  if (tab === 'other') return null;
  return (
    <>
      {tab === 'approved' ? null : (
        <Button className={WRAPPING} onClick={() => actions.decide(photo, 'APPROVED')}>
          {t('host.approve')}
        </Button>
      )}
      {tab === 'review' ? (
        <Button
          variant="outline"
          className={WRAPPING}
          onClick={() => actions.decide(photo, 'REJECTED')}
        >
          {t('host.reject')}
        </Button>
      ) : null}
      {tab === 'approved' ? (
        <Button
          variant="outline"
          className={WRAPPING}
          onClick={() => actions.decide(photo, 'REJECTED')}
        >
          {t('host.hide')}
        </Button>
      ) : null}
    </>
  );
}

/** A photo not yet READY, or one the worker could not use: no picture to show yet. */
function NotReady({ photo }: { photo: GalleryPhoto }) {
  const { t } = useTranslation('gallery');
  const failure = failureOf(photo);
  return (
    <div className="bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center p-3 text-center text-sm">
      {failure ? t(`host.failures.${failure}`) : t('host.preparing')}
    </div>
  );
}

/**
 * One photo for the hosts (design PD-65): its small copy, its caption as the guest wrote it, when it
 * was shared in the event's zone, and the tab's actions. Who shared it is not said (FR-48).
 */
export function ModerationCard({ photo, load, zone, actions }: CardProps) {
  const { t } = useTranslation('gallery');
  const alt = photo.caption ?? t('host.alt');
  const when = `${formatEventDay(photo.createdAt, zone)}, ${formatEventTime(photo.createdAt, zone)}`;
  return (
    <li className="bg-card border-border flex min-w-0 flex-col gap-3 border p-3">
      {photo.processing === 'READY' ? (
        <button
          type="button"
          aria-label={t('host.view', { name: alt })}
          onClick={() => actions.view(photo)}
          className="focus-visible:ring-ring block cursor-zoom-in border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:outline-none"
        >
          <GalleryPicture
            id={photo.id}
            variant="thumbnail"
            load={load(photo.id)}
            alt={alt}
            className="bg-muted aspect-square w-full object-cover"
          />
        </button>
      ) : (
        <NotReady photo={photo} />
      )}
      {photo.caption ? (
        <p dir="auto" className="m-0 text-sm break-words">
          {photo.caption}
        </p>
      ) : (
        <p className="text-muted-foreground m-0 text-sm">{t('host.noCaption')}</p>
      )}
      <p className="text-muted-foreground m-0 text-sm">{t('host.sharedAt', { when })}</p>
      <div className="flex flex-wrap gap-2">
        <Decisions photo={photo} actions={actions} />
        <Button variant="outline" className={WRAPPING} onClick={() => actions.remove(photo)}>
          {t('host.remove')}
        </Button>
      </div>
    </li>
  );
}
