import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GalleryPhoto, PhotoVariant } from '../types';
import { GalleryPicture } from './gallery-picture';
import { PhotoViewer } from './photo-viewer';

type Loader = (id: string) => (variant: PhotoVariant, signal: AbortSignal) => Promise<Blob>;

/**
 * Other guests' approved photos, as a grid of their small copies (PD-63). Each opens larger in a
 * dialog. Who shared a photo is never said: the list names no one (docs/API.md §11).
 */
export function GuestPhotos({ photos, load }: { photos: GalleryPhoto[]; load: Loader }) {
  const { t } = useTranslation('gallery');
  const [open, setOpen] = useState<GalleryPhoto | null>(null);
  const altOf = (photo: GalleryPhoto) => photo.caption ?? t('others.alt');
  return (
    <div className="flex flex-col gap-3">
      <h3 className="type-heading-3 text-heading m-0">{t('others.heading')}</h3>
      {photos.length === 0 ? (
        <p className="text-ink-muted m-0 text-sm">{t('others.none')}</p>
      ) : null}
      {photos.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3">
          {photos.map((photo) => (
            <li key={photo.id} className="flex min-w-0 flex-col gap-1">
              <button
                type="button"
                aria-label={t('others.open', { name: altOf(photo) })}
                onClick={() => setOpen(photo)}
                className="focus-visible:outline-focus block cursor-zoom-in border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <GalleryPicture
                  id={photo.id}
                  variant="thumbnail"
                  load={load(photo.id)}
                  alt={altOf(photo)}
                  className="aspect-square w-full object-cover"
                />
              </button>
              {photo.caption ? (
                <p dir="auto" className="text-ink-muted m-0 line-clamp-2 text-sm break-words">
                  {photo.caption}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <PhotoViewer label={altOf(open)} onClose={() => setOpen(null)}>
          <GalleryPicture
            id={open.id}
            variant="display"
            load={load(open.id)}
            alt={altOf(open)}
            className="mx-auto max-h-[78svh] w-auto max-w-full object-contain"
          />
          {open.caption ? (
            <p dir="auto" className="m-0 text-sm break-words">
              {open.caption}
            </p>
          ) : null}
        </PhotoViewer>
      ) : null}
    </div>
  );
}
