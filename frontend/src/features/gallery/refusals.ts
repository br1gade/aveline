import type { ApiError } from '@/api/errors';

/**
 * The two limits an upload can meet share one status and one code (409 `CONFLICT`, FR-28), so they
 * are told apart by the backend's exact words (`guest-media.service.ts`, `assertQuota`). **A
 * temporary stand-in** under FR-28, as PD-54 and PD-55 are: a reworded sentence falls back to the
 * status's own words, never to the wrong reason.
 */
const COUNT_LIMIT = /^uploads: photo count limit reached/;
const STORAGE_LIMIT = /^uploads: private storage limit reached/;

export function uploadConflict(error: ApiError): 'count' | 'storage' | 'other' {
  if (error.messages.some((message) => COUNT_LIMIT.test(message))) return 'count';
  if (error.messages.some((message) => STORAGE_LIMIT.test(message))) return 'storage';
  return 'other';
}

/**
 * A 400 about the caption rather than the file: `details` name the property, and class-validator's
 * message starts with it (FR-20). The caption is checked before sending, so this is rare.
 */
export function isCaptionRefusal(error: ApiError): boolean {
  return (
    error.details.some((detail) => detail.field === 'caption') ||
    error.messages.some((message) => message.startsWith('caption'))
  );
}
