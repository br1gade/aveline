import type { MetaDescriptor } from 'react-router';

import type { Invitation } from './types';

/** What a link preview may show: the hosts, the occasion, the cover. Never the guest (C-18). */
export interface PreviewMeta {
  title: string;
  image: string | null;
}

/** A guest page's loader data. */
export type InvitationPageData =
  { state: 'found'; invitation: Invitation; preview: PreviewMeta } | { state: 'not-found' };

const ROBOTS: MetaDescriptor = { name: 'robots', content: 'noindex, nofollow' };

/**
 * The head of a guest page (spec §12): the hosts and the occasion, and the cover as the preview
 * image. No guest name and no URL, since a personal page's URL is its credential.
 */
export function invitationMeta(data: InvitationPageData | undefined): MetaDescriptor[] {
  if (data?.state !== 'found') {
    return [{ title: 'Aveline' }, ROBOTS];
  }
  const { title, image } = data.preview;
  return [
    { title },
    ROBOTS,
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: title },
    ...(image ? [{ property: 'og:image', content: image }] : []),
  ];
}

/** The language a guest page is in: the one the response names (API.md §1). */
export function invitationLanguage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('invitation' in data)) {
    return undefined;
  }
  const { invitation } = data;
  return typeof invitation === 'object' &&
    invitation !== null &&
    'locale' in invitation &&
    typeof invitation.locale === 'string'
    ? invitation.locale
    : undefined;
}
