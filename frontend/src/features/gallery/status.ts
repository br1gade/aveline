import type { GalleryPhoto } from './types';

/**
 * A photo's state for the guest who shared it (PD-63). Others' photos reach a guest only once
 * shown. A status a later backend adds reads as still being prepared, or still waiting.
 */
export type GuestPhotoState = 'preparing' | 'waiting' | 'shown' | 'notApproved' | 'failed';

export function guestState(photo: GalleryPhoto): GuestPhotoState {
  if (photo.processing === 'FAILED') return 'failed';
  if (photo.processing !== 'READY') return 'preparing';
  if (photo.moderation === 'APPROVED') return 'shown';
  return photo.moderation === 'REJECTED' ? 'notApproved' : 'waiting';
}

/** The hosts' tabs (PD-65): to review, shown to guests, not approved, and the rest. */
export const MODERATION_TABS = ['review', 'approved', 'hidden', 'other'] as const;
export type ModerationTab = (typeof MODERATION_TABS)[number];

export function isModerationTab(value: string | null): value is ModerationTab {
  return MODERATION_TABS.some((tab) => tab === value);
}

/** Only a READY photo can be moderated; anything else is being prepared or failed. */
export function tabOf(photo: GalleryPhoto): ModerationTab {
  if (photo.processing !== 'READY') return 'other';
  if (photo.moderation === 'APPROVED') return 'approved';
  return photo.moderation === 'REJECTED' ? 'hidden' : 'review';
}

/** The worker is done with it, one way or the other. */
export function isSettled(photo: GalleryPhoto): boolean {
  return photo.processing === 'READY' || photo.processing === 'FAILED';
}

/** Why it failed: the file was not a usable image, or the failure was ours. */
export function failureOf(photo: GalleryPhoto): 'invalid' | 'ours' | null {
  if (photo.processing !== 'FAILED') return null;
  return photo.failure === 'INVALID_IMAGE' ? 'invalid' : 'ours';
}
