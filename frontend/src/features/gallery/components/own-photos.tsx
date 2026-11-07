import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Problem } from '@/api/problems';
import { formatEventDay, type EventZone } from '@/lib/time';
import { Button } from '@/ui';

import { failureOf, guestState } from '../status';
import type { GalleryPhoto, PhotoVariant } from '../types';
import { GalleryPicture } from './gallery-picture';
import type { RemoveResult } from './use-guest-gallery';

type Loader = (id: string) => (variant: PhotoVariant, signal: AbortSignal) => Promise<Blob>;

interface OwnPhotoProps {
  photo: GalleryPhoto;
  load: Loader;
  zone: EventZone;
  onRemove: (id: string) => Promise<RemoveResult>;
  onRemoved: (result: 'removed' | 'gone') => void;
}

function useProblemText(): (problem: Problem) => string {
  const { t } = useTranslation('gallery');
  return (problem) =>
    problem.code === 'rate-limited' || problem.code === 'unreachable'
      ? t(`problems.${problem.code}`)
      : t('own.removeFailed');
}

/** Remove, asked in place: "Remove this photo?" with Remove and Keep. */
function RemoveControl({ photo, onRemove, onRemoved }: Omit<OwnPhotoProps, 'load' | 'zone'>) {
  const { t } = useTranslation('gallery');
  const problemText = useProblemText();
  const [isAsking, setIsAsking] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const remove = async () => {
    setIsRemoving(true);
    const result = await onRemove(photo.id);
    setIsRemoving(false);
    if (result === 'removed' || result === 'gone') onRemoved(result);
    else setProblem(result);
  };
  if (!isAsking) {
    return (
      <Button variant="quiet" onClick={() => setIsAsking(true)} className="-ml-2 self-start">
        {t('own.remove')}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={t('own.confirm')} className="flex flex-col gap-2">
      <p className="m-0 text-sm">
        {guestState(photo) === 'shown' ? t('own.confirmShown') : t('own.confirm')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void remove()} disabled={isRemoving}>
          {t('own.removeConfirm')}
        </Button>
        <Button variant="quiet" onClick={() => setIsAsking(false)}>
          {t('own.keep')}
        </Button>
      </div>
      {problem ? <p className="text-error m-0 text-sm">{problemText(problem)}</p> : null}
    </div>
  );
}

function OwnPhoto({ photo, load, zone, onRemove, onRemoved }: OwnPhotoProps) {
  const { t } = useTranslation('gallery');
  const state = guestState(photo);
  const failure = failureOf(photo);
  const alt = photo.caption ?? t('own.alt');
  return (
    <li className="border-hairline flex gap-4 border-t pt-4">
      {photo.processing === 'READY' ? (
        <GalleryPicture
          id={photo.id}
          variant="thumbnail"
          load={load(photo.id)}
          alt={alt}
          className="size-24 shrink-0 object-cover"
        />
      ) : (
        <span aria-hidden="true" className="bg-surface-sunken size-24 shrink-0" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 text-sm font-medium">{t(`own.states.${state}`)}</p>
        {failure ? (
          <p className="text-ink-muted m-0 text-sm">{t(`own.failures.${failure}`)}</p>
        ) : null}
        {photo.caption ? (
          <p dir="auto" className="m-0 text-sm break-words">
            {photo.caption}
          </p>
        ) : null}
        <p className="text-ink-muted m-0 text-sm">
          {t('own.sharedOn', { date: formatEventDay(photo.createdAt, zone) })}
        </p>
        <RemoveControl photo={photo} onRemove={onRemove} onRemoved={onRemoved} />
      </div>
    </li>
  );
}

/**
 * The guest's own photos, in every state (PD-63): being prepared, waiting for the hosts, shown to
 * other guests, not approved, or not usable. Each can be removed, approved ones included, after a
 * question in place; a status line then says so, with the focus.
 */
export function OwnPhotos({
  photos,
  load,
  zone,
  onRemove,
}: Omit<OwnPhotoProps, 'photo' | 'onRemoved'> & { photos: GalleryPhoto[] }) {
  const { t } = useTranslation('gallery');
  const [status, setStatus] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);
  const onRemoved = (result: 'removed' | 'gone') => {
    setStatus(result === 'removed' ? t('own.removed') : t('own.gone'));
    requestAnimationFrame(() => statusRef.current?.focus());
  };
  return (
    <div className="flex flex-col gap-3">
      <h3 className="type-heading-3 text-heading m-0">{t('own.heading')}</h3>
      <p ref={statusRef} role="status" tabIndex={-1} className="m-0 text-sm empty:hidden">
        {status}
      </p>
      {photos.length === 0 ? <p className="text-ink-muted m-0 text-sm">{t('own.none')}</p> : null}
      {photos.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {photos.map((photo) => (
            <OwnPhoto
              key={photo.id}
              photo={photo}
              load={load}
              zone={zone}
              onRemove={onRemove}
              onRemoved={onRemoved}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
