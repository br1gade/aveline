import { useTranslation } from 'react-i18next';

import { cx, Icon, SectionHeading } from '@/ui';

import { imageSource } from '../components/image-source';
import { useMusic } from '../components/music';
import { Section, variantOf } from '../components/section';
import { photos, titledContent } from '../schemas';
import type { BlockMedia } from '../types';
import type { BlockProps } from './block-props';

type GalleryVariant = 'editorial' | 'grid' | 'carousel';

/**
 * `editorial`: two columns on phones with every third photograph full width, three from 768 px.
 * `grid`: even squares. `carousel`: snapping horizontal scroll on phones, a grid from 768 px.
 */
const ITEM: Record<GalleryVariant, (index: number) => string> = {
  editorial: (index) =>
    index % 3 === 0 ? 'col-span-2 aspect-[3/2] md:col-span-1 md:aspect-[4/5]' : 'aspect-[4/5]',
  grid: () => 'aspect-square',
  carousel: () => 'aspect-[4/5] w-[80%] flex-none snap-start md:w-auto',
};

/**
 * How wide each photograph shows on a phone, so the browser picks the right copy from `srcset`.
 * From 768 px every layout is three columns of the letter column.
 */
const PHONE_WIDTH: Record<GalleryVariant, (index: number) => string> = {
  editorial: (index) => (index % 3 === 0 ? '100vw' : '50vw'),
  grid: () => '50vw',
  carousel: () => '80vw',
};

const CONTAINER: Record<GalleryVariant, string> = {
  editorial: 'grid grid-cols-2 gap-2 md:grid-cols-3',
  grid: 'grid grid-cols-2 gap-2 md:grid-cols-3',
  carousel:
    'flex snap-x snap-mandatory gap-2 overflow-x-auto md:grid md:grid-cols-3 md:overflow-visible',
};

interface PhotoProps {
  photo: BlockMedia;
  className: string;
  phoneWidth: string;
}

function Photo({ photo, className, phoneWidth }: PhotoProps) {
  return (
    <img
      {...imageSource(photo)}
      alt={photo.altText ?? ''}
      loading="lazy"
      decoding="async"
      sizes={`(min-width: 768px) 14rem, ${phoneWidth}`}
      className={cx('bg-sand block w-full object-cover', className)}
    />
  );
}

/**
 * Photographs in the host's order, as the smaller copies the backend makes. Alt text when the host
 * gave it, empty otherwise. Every one loads lazily.
 */
export function GalleryBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const items = photos(block);
  if (items.length === 0) return null;
  const { title } = titledContent(block);
  const heading = title ?? t('gallery.heading');
  const variant = variantOf<GalleryVariant>(block.variant, ['editorial', 'grid', 'carousel']);
  // A scrolling region must be reachable by keyboard and named (WCAG 2.1.1).
  const scroller =
    variant === 'carousel' ? { tabIndex: 0, role: 'region', 'aria-label': heading } : {};
  return (
    <Section>
      <SectionHeading label={t('gallery.label')} heading={heading} />
      <div className={CONTAINER[variant]} {...scroller}>
        {items.map((photo, index) => (
          <Photo
            key={photo.id}
            photo={photo}
            className={ITEM[variant](index)}
            phoneWidth={PHONE_WIDTH[variant](index)}
          />
        ))}
      </div>
    </Section>
  );
}

/**
 * By default the music lives in the top bar and the block shows nothing. `card` adds a small card
 * with the same control. Never plays on its own (R-20).
 */
export function MusicBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const music = useMusic();
  if (!music || variantOf(block.variant, ['default', 'card']) !== 'card') return null;
  const { title } = titledContent(block);
  return (
    <Section>
      <div className="border-hairline bg-surface-raised flex items-center gap-4 border p-6">
        <button
          type="button"
          aria-pressed={music.isPlaying}
          onClick={music.toggle}
          className="border-action text-action hover:bg-surface-sunken inline-flex size-12 flex-none cursor-pointer items-center justify-center border"
        >
          <Icon name={music.isPlaying ? 'pause' : 'volume-2'} />
          <span className="sr-only">{t('music.label')}</span>
        </button>
        <div className="flex min-w-0 flex-col">
          {title ? <h2 className="type-heading-2 text-heading m-0">{title}</h2> : null}
          <p className="text-text-muted m-0 text-sm leading-[22px]">
            {music.isPlaying ? t('music.on') : t('music.off')}
          </p>
        </div>
      </div>
    </Section>
  );
}
