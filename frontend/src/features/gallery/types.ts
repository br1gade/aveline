/**
 * The gallery's answers (docs/API.md §11), checked against the schema at each call (FR-1).
 * Read from the backend's `guest-media.service.ts` (`MEDIA_SELECT`) at `eb77cd4`.
 */

/** `GuestMediaStatus`; anything else a later backend adds is read as still being prepared. */
export type ProcessingStatus = 'STAGING' | 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'REMOVED';

/** `GalleryModerationStatus`. */
export type ModerationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** The display copy the backend adds to a failed item (`JobRecoveryInterceptor`). Not shown. */
interface RecoveryWire {
  code: string;
  action: string;
}

export interface GalleryItemWire {
  id: string;
  kind: string;
  processingStatus: string;
  moderationStatus: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  moderatedAt: string | null;
  /** `INVALID_IMAGE`, `STORAGE_UNAVAILABLE` or `ATTEMPTS_EXHAUSTED`. */
  failureReason: string | null;
  recovery?: RecoveryWire | null;
  /** On the guest's list only: whether this guest shared it. */
  isOwn?: boolean;
}

export interface GalleryLimitsWire {
  perGuest: number;
  perEvent: number;
  bytesPerEvent: number;
  bytesPerFile: number;
}

export interface GuestGalleryWire {
  items: GalleryItemWire[];
  nextCursor: string | null;
  limits?: GalleryLimitsWire;
}

export interface HostGalleryWire {
  items: GalleryItemWire[];
  nextCursor: string | null;
  uploadsEnabled: boolean;
}

/** One photo as the pages hold it: its fields named, nothing else kept. */
export interface GalleryPhoto {
  id: string;
  processing: string;
  moderation: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** The worker's failure code, or `null`. */
  failure: string | null;
  /** The guest's own; always `false` on the hosts' list, which names no uploader (FR-48). */
  isOwn: boolean;
}

export interface GalleryPage {
  photos: GalleryPhoto[];
  nextCursor: string | null;
}

/** The hosts' list also says whether guests can share (FR-46). */
export interface HostGalleryPage extends GalleryPage {
  uploadsEnabled: boolean;
}

export type PhotoVariant = 'thumbnail' | 'display';
