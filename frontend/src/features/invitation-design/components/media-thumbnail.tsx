import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { browserSession } from '@/api/session';
import { hostArtworkLoader, imageSource, type PrivateAsset } from '@/features/invitation-renderer';
import { PrivateImage } from '@/ui';

import type { DesignMedia } from '../types';

const KINDS = ['PHOTO', 'COVER', 'LOGO', 'AUDIO'] as const;
type Kind = (typeof KINDS)[number];

function isKind(kind: string): kind is Kind {
  return (KINDS as readonly string[]).includes(kind);
}

/** An upload's kind in words; one this release does not know, as it came. */
export function useKindName(): (kind: string) => string {
  const { t } = useTranslation('design');
  return (kind) => (isKind(kind) ? t(`media.kinds.${kind}`) : kind);
}

/** The page's language, then the event's default, then any: what the host wrote about it. */
export function altTextOf(media: DesignMedia, languages: readonly string[]): string | undefined {
  for (const language of languages) {
    const text = media.altText[language];
    if (text) return text;
  }
  return Object.values(media.altText)[0];
}

/** A private picture, shown from memory: its address needs the host's bearer token (PD-140). */
function PrivateThumbnail({ asset }: { asset: PrivateAsset }) {
  const { eventId = '' } = useParams();
  const className = 'bg-muted size-16 shrink-0 object-cover';
  return (
    <PrivateImage
      id={asset.id}
      load={(signal) => hostArtworkLoader(browserSession().api, eventId)(asset, signal)}
      alt=""
      className={className}
      renderFailed={() => <span aria-hidden="true" className={`block ${className}`} />}
    />
  );
}

function Picture({ media }: { media: DesignMedia }) {
  const { t } = useTranslation('design');
  if (media.kind === 'AUDIO') {
    return (
      <span className="bg-muted text-muted-foreground flex size-16 shrink-0 items-center justify-center text-xs">
        {t('media.kinds.AUDIO')}
      </span>
    );
  }
  if (media.privateAsset) return <PrivateThumbnail asset={media.privateAsset} />;
  return (
    <img
      {...imageSource({ ...media, altText: null })}
      sizes="64px"
      alt=""
      loading="lazy"
      decoding="async"
      className="bg-muted size-16 shrink-0 object-cover"
    />
  );
}

interface ThumbnailProps {
  media: DesignMedia;
  /** Where to look for its description first. */
  languages: readonly string[];
}

/**
 * An upload, small: the picture from its smallest copy, or the word "Audio". The picture is
 * decorative; the words beside it say what it is.
 */
export function MediaThumbnail({ media, languages }: ThumbnailProps) {
  const { t } = useTranslation('design');
  const kindName = useKindName();
  const description = altTextOf(media, languages);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Picture media={media} />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{kindName(media.kind)}</span>
        <span className="text-muted-foreground text-sm break-words">
          {description ?? t('media.noDescription')}
        </span>
      </span>
    </div>
  );
}
