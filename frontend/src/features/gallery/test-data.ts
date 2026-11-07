import type { GalleryItemWire, GalleryPhoto } from './types';

/** One gallery item as the backend sends it, READY and waiting for the hosts unless told. */
export function itemWire(overrides: Partial<GalleryItemWire> = {}): GalleryItemWire {
  return {
    id: 'm1',
    kind: 'GALLERY',
    processingStatus: 'READY',
    moderationStatus: 'PENDING',
    caption: null,
    width: 2048,
    height: 1365,
    createdAt: '2027-06-12T18:30:00.000Z',
    moderatedAt: null,
    failureReason: null,
    recovery: null,
    ...overrides,
  };
}

/** The same, as the page reads it. */
export function photo(overrides: Partial<GalleryPhoto> = {}): GalleryPhoto {
  return {
    id: 'm1',
    processing: 'READY',
    moderation: 'PENDING',
    caption: null,
    width: 2048,
    height: 1365,
    createdAt: '2027-06-12T18:30:00.000Z',
    failure: null,
    isOwn: false,
    ...overrides,
  };
}

/** A file as the browser gives it; only its name, type and size matter here. */
export function picked(name: string, type = 'image/jpeg', size = 2_000_000): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}
