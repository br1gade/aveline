import type {
  GalleryItemWire,
  GalleryPage,
  GalleryPhoto,
  GuestGalleryWire,
  HostGalleryPage,
  HostGalleryWire,
} from './types';

/** Each field named, so nothing else an item may carry goes further (ARCHITECTURE §9). */
export function readPhoto(wire: GalleryItemWire): GalleryPhoto {
  return {
    id: wire.id,
    processing: wire.processingStatus,
    moderation: wire.moderationStatus,
    caption: wire.caption ?? null,
    width: wire.width ?? null,
    height: wire.height ?? null,
    createdAt: wire.createdAt,
    failure: wire.failureReason ?? null,
    isOwn: wire.isOwn === true,
  };
}

/** Only gallery items: a list that one day held another kind would not show it as a photo. */
function readItems(items: readonly GalleryItemWire[]): GalleryPhoto[] {
  return items.filter((item) => item.kind === 'GALLERY').map(readPhoto);
}

export function readGuestPage(wire: GuestGalleryWire): GalleryPage {
  return { photos: readItems(wire.items), nextCursor: wire.nextCursor ?? null };
}

export function readHostPage(wire: HostGalleryWire): HostGalleryPage {
  return {
    photos: readItems(wire.items),
    nextCursor: wire.nextCursor ?? null,
    uploadsEnabled: wire.uploadsEnabled,
  };
}
