import { PrivateImage } from '@/ui';

import { useArtwork } from '../context';
import type { BlockMedia } from '../types';
import { imageSource } from './image-source';

interface InvitationImageProps {
  photo: BlockMedia;
  sizes: string;
  /** The cover is on the first screen and loads at once; anything else waits until near. */
  isEager?: boolean;
  className: string;
}

/**
 * A photograph on the page. Private artwork is read through the API and shown from memory: its
 * address may hold the guest's token (design PD-140). Until then the space it takes shows the
 * field's own colour, and one that can't be read stays that way, as the page stands without it.
 */
export function InvitationImage({
  photo,
  sizes,
  isEager = false,
  className,
}: InvitationImageProps) {
  const load = useArtwork();
  const { privateAsset } = photo;
  const alt = photo.altText ?? '';
  if (privateAsset) {
    const placeholder = () => <span aria-hidden="true" className={`block ${className}`} />;
    return load ? (
      <PrivateImage
        id={privateAsset.id}
        load={(signal) => load(privateAsset, signal)}
        alt={alt}
        className={className}
        renderFailed={placeholder}
      />
    ) : (
      placeholder()
    );
  }
  return (
    <img
      {...imageSource(photo)}
      alt={alt}
      sizes={sizes}
      loading={isEager ? 'eager' : 'lazy'}
      decoding="async"
      {...(isEager ? { fetchPriority: 'high' as const } : {})}
      className={className}
    />
  );
}
