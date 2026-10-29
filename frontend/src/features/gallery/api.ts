import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import { readGuestPage, readHostPage, readPhoto } from './read';
import type {
  GalleryItemWire,
  GalleryPage,
  GalleryPhoto,
  GuestGalleryWire,
  HostGalleryWire,
  ModerationStatus,
  PhotoVariant,
} from './types';

/** A personal link's address. The token is a credential: it goes to the API and nowhere else. */
export interface GalleryLink {
  slug: string;
  guestToken: string;
}

/** The most one read returns (docs/API.md §11: 1–100). */
export const PAGE_SIZE = 100;

interface PageQuery {
  limit?: components['schemas']['Object'];
  after?: string;
}

/**
 * A page of a contribution list. The schema types `limit` as an object (FR-38), so the query goes
 * through this one cast.
 */
function pageQuery(after: string | undefined): PageQuery {
  const query = after ? { limit: PAGE_SIZE, after } : { limit: PAGE_SIZE };
  return query as unknown as PageQuery;
}

// ── The guest's side, on their personal link ──

/** Their own photos in any state, and other guests' approved ones, newest first. */
export async function listGuestGallery(
  api: ApiClient,
  link: GalleryLink,
  after?: string,
): Promise<GalleryPage> {
  const wire = await expectData<GuestGalleryWire>(
    api.GET('/api/v1/invitations/{slug}/g/{guestToken}/gallery', {
      params: { path: link, query: pageQuery(after) },
    }),
  );
  return readGuestPage(wire);
}

/** One photo as one multipart request: an optional `caption`, then `file`. It arrives QUEUED. */
export async function uploadPhoto(
  api: ApiClient,
  link: GalleryLink,
  file: File,
  caption: string | undefined,
): Promise<GalleryPhoto> {
  const form = new FormData();
  if (caption) form.append('caption', caption);
  form.append('file', file, file.name);
  const wire = await expectData<GalleryItemWire>(
    api.POST('/api/v1/invitations/{slug}/g/{guestToken}/gallery', {
      params: { path: link },
      body: {},
      bodySerializer: () => form,
    }),
  );
  return { ...readPhoto(wire), isOwn: true };
}

/** Their own photo, in any state, approved ones included. */
export async function removeOwnPhoto(
  api: ApiClient,
  link: GalleryLink,
  mediaId: string,
): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/invitations/{slug}/g/{guestToken}/gallery/{mediaId}', {
      params: { path: { ...link, mediaId } },
    }),
  );
}

/** A processed copy's bytes; never the original. Read through `PrivateImage`, never an `<img src>`. */
export function guestPhotoFile(
  api: ApiClient,
  photo: GalleryLink & { mediaId: string },
  variant: PhotoVariant,
  signal: AbortSignal,
): Promise<Blob> {
  return expectData<Blob>(
    api.GET('/api/v1/invitations/{slug}/g/{guestToken}/gallery/{mediaId}/file', {
      params: { path: photo, query: { variant } },
      parseAs: 'blob',
      signal,
    }),
  );
}

// ── The hosts' side, signed in (`guest:write`) ──

export async function listEventGallery(
  api: ApiClient,
  eventId: string,
  after?: string,
): Promise<GalleryPage> {
  const wire = await expectData<HostGalleryWire>(
    api.GET('/api/v1/events/{eventId}/gallery', {
      params: { path: { eventId }, query: pageQuery(after) },
    }),
  );
  return readHostPage(wire);
}

/** Approve, or not; a photo must be READY and still there, otherwise 409. */
export async function moderatePhoto(
  api: ApiClient,
  eventId: string,
  mediaId: string,
  moderationStatus: Exclude<ModerationStatus, 'PENDING'>,
): Promise<GalleryPhoto> {
  const wire = await expectData<GalleryItemWire>(
    api.PATCH('/api/v1/events/{eventId}/gallery/{mediaId}', {
      params: { path: { eventId, mediaId } },
      body: { moderationStatus },
    }),
  );
  return readPhoto(wire);
}

export async function removePhoto(api: ApiClient, eventId: string, mediaId: string): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/gallery/{mediaId}', {
      params: { path: { eventId, mediaId } },
    }),
  );
}

/** The bearer token cannot go in an `<img src>`, so the bytes are read here (`PrivateImage`). */
export function eventPhotoFile(
  api: ApiClient,
  photo: { eventId: string; mediaId: string },
  variant: PhotoVariant,
  signal: AbortSignal,
): Promise<Blob> {
  return expectData<Blob>(
    api.GET('/api/v1/events/{eventId}/gallery/{mediaId}/file', {
      params: { path: photo, query: { variant } },
      parseAs: 'blob',
      signal,
    }),
  );
}
