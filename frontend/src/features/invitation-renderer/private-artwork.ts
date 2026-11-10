import type { ApiClient, PublicApiClient } from '@/api/client';
import { expectData } from '@/api/client';

import type { PrivateAsset } from './types';

/**
 * Artwork from an authored template is private, and its address is relative to the API. On a
 * personal page it holds the guest's token (`invitations.service.ts`, `designAssetPrefix`), so it
 * must never reach the loader's data, the page's HTML, an `<img src>`, every resource listing or a
 * link preview (docs/API.md §6). The server's reader rewrites each such address to the asset's id,
 * and the browser reads the bytes through the API client (design PD-140). **A temporary stand-in**:
 * these shapes are recognised under a test that reads the backend, until FR-115 gives an id.
 */
const CATALOGUE = /\/events\/[^/]+\/design-templates\/([^/]+)\/assets\/([^/?#]+)\/file(?:[?#]|$)/;
const DESIGN_ASSET =
  /\/(?:invitations\/[^/]+(?:\/g\/[^/]+)?|events\/[^/]+)\/design-assets\/([^/?#]+)\/file(?:[?#]|$)/;
/** Any other way it might come to be written holds the token just the same: gone, without an id. */
const ANY_ARTWORK_ADDRESS = /\/design-assets\//;

export function privateAssetOf(address: string): PrivateAsset | null {
  const catalogue = CATALOGUE.exec(address);
  if (catalogue?.[1] && catalogue[2]) return { id: catalogue[2], templateKey: catalogue[1] };
  const asset = DESIGN_ASSET.exec(address)?.[1];
  return asset ? { id: asset } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function withoutAddresses(value: unknown): unknown {
  if (typeof value === 'string') return ANY_ARTWORK_ADDRESS.test(value) ? null : value;
  if (Array.isArray(value)) return value.map(withoutAddresses);
  if (!isRecord(value)) return value;
  const walked = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withoutAddresses(item)]),
  );
  const asset = typeof value.url === 'string' ? privateAssetOf(value.url) : null;
  return asset ? { ...walked, url: '', privateAsset: asset } : walked;
}

/** The payload with every private address gone, wherever the backend's projection left one. */
export function withPrivateArtwork<T>(payload: T): T {
  return withoutAddresses(payload) as T;
}

export type ArtworkLoader = (asset: PrivateAsset, signal: AbortSignal) => Promise<Blob>;

/** Through the guest's own link, or the invitation's on the generic page. */
export function guestArtworkLoader(
  api: PublicApiClient,
  { slug, guestToken }: { slug: string; guestToken?: string | undefined },
): ArtworkLoader {
  return ({ id }, signal) =>
    expectData<Blob>(
      guestToken
        ? api.GET('/api/v1/invitations/{slug}/g/{guestToken}/design-assets/{assetId}/file', {
            params: { path: { slug, guestToken, assetId: id } },
            parseAs: 'blob',
            signal,
          })
        : api.GET('/api/v1/invitations/{slug}/design-assets/{assetId}/file', {
            params: { path: { slug, assetId: id } },
            parseAs: 'blob',
            signal,
          }),
    );
}

/** With the host's bearer token, which an image element could not send. */
export function hostArtworkLoader(api: ApiClient, eventId: string): ArtworkLoader {
  return ({ id, templateKey }, signal) =>
    expectData<Blob>(
      templateKey
        ? api.GET('/api/v1/events/{eventId}/design-templates/{templateKey}/assets/{assetId}/file', {
            params: { path: { eventId, templateKey, assetId: id } },
            parseAs: 'blob',
            signal,
          })
        : api.GET('/api/v1/events/{eventId}/design-assets/{assetId}/file', {
            params: { path: { eventId, assetId: id } },
            parseAs: 'blob',
            signal,
          }),
    );
}
