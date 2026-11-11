import type { ApiClient, PublicApiClient } from '@/api/client';
import { expectData } from '@/api/client';

import type { PrivateAsset } from './types';

/**
 * Artwork from an authored template is private. A guest's page asks for it by id (FR-115) and is
 * given `{ kind: "private-design-asset", assetId }`; every other page, and a backend not yet
 * answering that way, gives an address relative to the API, which on a personal page holds the
 * guest's token (`invitations.service.ts`, `designAssetPrefix`). Neither may reach the loader's
 * data, the page's HTML, an `<img src>`, every resource listing or a link preview (docs/API.md §6):
 * the server's reader names each by the asset's id, and the browser reads the bytes through the API
 * client (design PD-140). The addresses are recognised under a test that reads the backend.
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

/** The id a guest's page names a private picture by (FR-115). */
function referencedAsset(value: unknown): PrivateAsset | null {
  return isRecord(value) &&
    value.kind === 'private-design-asset' &&
    typeof value.assetId === 'string'
    ? { id: value.assetId }
    : null;
}

function privateAssetAt(url: unknown): PrivateAsset | null {
  return typeof url === 'string' ? privateAssetOf(url) : referencedAsset(url);
}

/** A reference standing alone, as `coverUrl`, is gone: a link preview gets no private picture. */
function withoutAddresses(value: unknown): unknown {
  if (typeof value === 'string') return ANY_ARTWORK_ADDRESS.test(value) ? null : value;
  if (Array.isArray(value)) return value.map(withoutAddresses);
  if (!isRecord(value)) return value;
  // A reference standing alone, or one without a usable id, goes: nothing of it is shown.
  if (value.kind === 'private-design-asset') return null;
  const walked = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withoutAddresses(item)]),
  );
  const asset = privateAssetAt(value.url);
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
    expectData(
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
    expectData(
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
