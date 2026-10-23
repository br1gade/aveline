import { useTranslation } from 'react-i18next';

import { cx, Icon, SectionHeading } from '@/ui';

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

const CONTAINER: Record<GalleryVariant, string> = {
  editorial: 'grid grid-cols-2 gap-2 md:grid-cols-3',
  grid: 'grid grid-cols-2 gap-2 md:grid-cols-3',
  carousel:
    'flex snap-x snap-mandatory gap-2 overflow-x-auto md:grid md:grid-cols-3 md:overflow-visible',
};

function Photo({ photo, className }: { photo: BlockMedia; className: string }) {
  return (
    <img
      src={photo.url}
      alt={photo.altText ?? ''}
      loading="lazy"
      decoding="async"
      sizes="(min-width: 768px) 14rem, 50vw"
      className={cx('bg-sand block w-full object-cover', className)}
    />
  );
}

/**
 * Photographs in the host's order. Alt text when the host gave it, empty otherwise (F11). Until
 * F18 they are served as uploaded, so every one loads lazily.
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
          <Photo key={photo.id} photo={photo} className={ITEM[variant](index)} />
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
