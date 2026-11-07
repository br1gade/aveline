import type { MetaDescriptor } from 'react-router';

import { createI18n, type Language } from '@/lib/i18n';

import type { PublicEvent } from './types';

/** An address the backend gave as a path, made absolute on this client's public origin. */
function absolute(origin: string, path: string): string {
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}

function imageTags(event: PublicEvent, origin: string): MetaDescriptor[] {
  const { image } = event.metadata;
  if (!image) return [];
  return [
    { property: 'og:image', content: absolute(origin, image.url) },
    ...(image.width ? [{ property: 'og:image:width', content: String(image.width) }] : []),
    ...(image.height ? [{ property: 'og:image:height', content: String(image.height) }] : []),
    ...(image.altText ? [{ property: 'og:image:alt', content: image.altText }] : []),
    { name: 'twitter:card', content: 'summary_large_image' },
  ];
}

/**
 * The head of a public event's page, from the response's `metadata` verbatim (docs/API.md §5):
 * its title and description, its share image, its languages, its canonical address and its robots
 * rule, which is never overridden. Link previews in chat apps read these from the server's HTML.
 */
export function publicEventMeta(event: PublicEvent | undefined, origin: string): MetaDescriptor[] {
  if (!event) {
    return [{ title: 'Aveline' }, { name: 'robots', content: 'noindex,nofollow' }];
  }
  const { metadata } = event;
  const title = metadata.title ?? event.headline ?? 'Aveline';
  const url = absolute(origin, metadata.canonicalPath);
  return [
    { title },
    { name: 'robots', content: metadata.robots },
    ...(metadata.description ? [{ name: 'description', content: metadata.description }] : []),
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: url },
    { property: 'og:title', content: title },
    ...(metadata.description
      ? [{ property: 'og:description', content: metadata.description }]
      : []),
    ...(metadata.locale ? [{ property: 'og:locale', content: metadata.locale }] : []),
    ...metadata.alternateLocales.map((locale) => ({
      property: 'og:locale:alternate',
      content: locale,
    })),
    ...imageTags(event, origin),
  ];
}

/** The language a public event's page is in: the one the response names (docs/API.md §1). */
export function publicEventLanguage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('event' in data)) return undefined;
  const { event } = data;
  return typeof event === 'object' &&
    event !== null &&
    'locale' in event &&
    typeof event.locale === 'string'
    ? event.locale
    : undefined;
}

/**
 * Browsing public events. Whether a directory of them should be indexed is product's call (design
 * PD-103), so it isn't, while each event's own page keeps its own rule.
 */
export function publicListingMeta(language: Language): MetaDescriptor[] {
  const t = createI18n(language).getFixedT(language, 'public-event');
  return [
    { title: t('listing.metaTitle') },
    { name: 'robots', content: 'noindex,follow' },
    { name: 'description', content: t('listing.lead') },
  ];
}
