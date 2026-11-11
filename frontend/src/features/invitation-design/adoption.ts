import { isApiError } from '@/api/errors';
import { withPrivateArtwork } from '@/features/invitation-renderer';

import type { Preview } from './types';

/**
 * Adopting an authored template (docs/API.md §6; design PD-139): an exact version, previewed
 * against the design as it stands, then confirmed. The catalogue says which templates need this
 * (FR-114); the refusal of choosing one by key is kept for a list read before it did.
 */
export interface AdoptionChanges {
  themeReset: boolean;
  disabledBlocks: readonly string[];
  resetVariants: readonly string[];
}

export type AdoptionRead =
  | {
      state: 'ready';
      previewId: string;
      sourceVersionId: string;
      targetVersionId: string;
      expectedDesignRevision: string;
      changes: AdoptionChanges;
      /** The invitation as it would read, by language; no guest, nothing can be answered. */
      payloads: Readonly<Record<string, Preview>>;
    }
  | { state: 'processing'; previewId: string }
  | { state: 'failed'; previewId: string };

export type AdoptionWire = Record<string, unknown>;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Anything but ready or failed is still being prepared. `pollUrl` goes no further than here. */
export function readAdoption(wire: AdoptionWire): AdoptionRead {
  const previewId = text(wire.previewId);
  if (wire.state === 'FAILED') return { state: 'failed', previewId };
  if (wire.state !== 'READY') return { state: 'processing', previewId };
  const changes = (wire.changes ?? {}) as Record<string, unknown>;
  return {
    state: 'ready',
    previewId,
    sourceVersionId: text(wire.sourceVersionId),
    targetVersionId: text(wire.targetVersionId),
    expectedDesignRevision: text(wire.expectedDesignRevision),
    changes: {
      themeReset: changes.themeReset === true,
      disabledBlocks: strings(changes.disabledBlocks),
      resetVariants: strings(changes.resetVariants),
    },
    payloads: withPrivateArtwork((wire.payloads ?? {}) as Record<string, Preview>),
  };
}

export function isPreviewRequired(error: unknown): boolean {
  return isApiError(error) && error.code === 'TEMPLATE_PREVIEW_REQUIRED';
}

type RefusalKind =
  'stale' | 'gone' | 'preparing' | 'invalid' | 'unavailable' | 'forbidden' | 'rateLimited';

export type AdoptionRefusal =
  | { kind: RefusalKind }
  | { kind: 'noAnswer'; requestId: string | undefined }
  | { kind: 'other'; sentence: string };

/** Stable codes: no sentence is read, as elsewhere it has to be (FR-28). */
const BY_CODE: Readonly<Record<string, RefusalKind>> = {
  TEMPLATE_PREVIEW_STALE: 'stale',
  TEMPLATE_PREVIEW_UNAVAILABLE: 'stale',
  TEMPLATE_IDEMPOTENCY_CONFLICT: 'stale',
  TEMPLATE_STATE_CHANGED: 'gone',
  TEMPLATE_NOT_FOUND: 'gone',
  TEMPLATE_ASSET_NOT_READY: 'preparing',
  TEMPLATE_ASSET_INVALID: 'invalid',
  TEMPLATE_FEATURE_DISABLED: 'unavailable',
  TEMPLATE_CAPABILITY_NOT_DEPLOYED: 'unavailable',
  TEMPLATE_CAPABILITY_REQUIRED: 'unavailable',
};

export function adoptionRefusalOf(error: unknown): AdoptionRefusal {
  if (!isApiError(error)) throw error;
  const known = error.code ? BY_CODE[error.code] : undefined;
  if (known) return { kind: known };
  if (error.status === 0 || error.status >= 500) {
    return { kind: 'noAnswer', requestId: error.requestId };
  }
  if (error.status === 403) return { kind: 'forbidden' };
  if (error.status === 429) return { kind: 'rateLimited' };
  return { kind: 'other', sentence: error.messages.join(' ') };
}
