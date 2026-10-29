import type { GalleryPage, GalleryPhoto } from './types';

/** The API's order, newest first: by when it was shared, then by id (`guest-media.service.ts`). */
function isOlder(photo: GalleryPhoto, than: GalleryPhoto): boolean {
  if (photo.createdAt !== than.createdAt) return photo.createdAt < than.createdAt;
  return photo.id < than.id;
}

/** Photos just shared go first; one already held is replaced where it stands. */
export function withShared(
  held: readonly GalleryPhoto[],
  shared: readonly GalleryPhoto[],
): GalleryPhoto[] {
  const byId = new Map(shared.map((item) => [item.id, item]));
  const heldIds = new Set(held.map((item) => item.id));
  const added = shared.filter((item) => !heldIds.has(item.id));
  return [...added, ...held.map((item) => byId.get(item.id) ?? item)];
}

/** A later page's photos after the ones held, each once. */
export function withNextPage(held: readonly GalleryPhoto[], page: GalleryPage): GalleryPhoto[] {
  const heldIds = new Set(held.map((item) => item.id));
  return [...held, ...page.photos.filter((item) => !heldIds.has(item.id))];
}

/**
 * The first page read again is the truth for everything it covers: a photo held there but no
 * longer in it was withdrawn, removed or refused meanwhile, and goes. Without a next page it is
 * the whole list; otherwise the older photos a later page brought stay below it.
 */
export function withFirstPage(held: readonly GalleryPhoto[], page: GalleryPage): GalleryPhoto[] {
  const last = page.photos.at(-1);
  if (!page.nextCursor || !last) return [...page.photos];
  const ids = new Set(page.photos.map((item) => item.id));
  return [...page.photos, ...held.filter((item) => !ids.has(item.id) && isOlder(item, last))];
}

export function withoutPhoto(held: readonly GalleryPhoto[], id: string): GalleryPhoto[] {
  return held.filter((item) => item.id !== id);
}
