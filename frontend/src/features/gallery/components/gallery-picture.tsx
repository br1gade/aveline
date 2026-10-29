import { useTranslation } from 'react-i18next';

import { Button, PrivateImage } from '@/ui';

import type { PhotoVariant } from '../types';

interface GalleryPictureProps {
  id: string;
  variant: PhotoVariant;
  load: (variant: PhotoVariant, signal: AbortSignal) => Promise<Blob>;
  alt: string;
  className?: string;
}

/**
 * One private photo, its copy read through the API (`PrivateImage`), never from an address in the
 * page. When it cannot be read, a line and "Try again" stand in its place.
 */
export function GalleryPicture({ id, variant, load, alt, className }: GalleryPictureProps) {
  const { t } = useTranslation('gallery');
  return (
    <PrivateImage
      id={`${id}-${variant}`}
      load={(signal) => load(variant, signal)}
      alt={alt}
      className={className}
      renderFailed={(retry) => (
        <span className="text-ink-muted flex flex-col items-start gap-1 p-2 text-sm">
          {t('picture.failed')}
          <Button variant="quiet" onClick={retry}>
            {t('picture.retry')}
          </Button>
        </span>
      )}
    />
  );
}
