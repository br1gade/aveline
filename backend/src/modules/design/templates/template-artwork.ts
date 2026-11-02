import type { ContentMedia } from '../../invitations/invitation-content';
import { BlockType, Prisma } from '@prisma/client';
import { DomainHttpException } from '../../../common/domain-http.exception';
import { hashTemplateContent } from './template-content';
export interface TemplateArtwork {
  assetId: string; slot: string; position: number; contentHash: string; width: number; height: number; mimeType: string; kind: string;
}
export async function readDraftArtwork(tx: Prisma.TransactionClient, draftId: string): Promise<TemplateArtwork[]> {
  return tx.$queryRaw<TemplateArtwork[]>`SELECT r."assetId",r.slot,r.position,a."contentHash",a.width,a.height,a."mimeType",a.kind
    FROM design_template_asset_references r JOIN design_template_assets a ON a.id=r."assetId"
    WHERE r."draftId"=${draftId} AND a.state='AVAILABLE' ORDER BY r.slot,r.position`;
}
export async function hashDraftSnapshot(tx: Prisma.TransactionClient, draftId: string, definition: unknown) {
  return hashTemplateContent({ definition, artwork: await readDraftArtwork(tx, draftId) });
}
export async function lockDraftArtwork(tx: Prisma.TransactionClient, draftId: string): Promise<TemplateArtwork[]> {
  const ids = await tx.designTemplateAssetReference.findMany({ where: { draftId }, select: { assetId: true }, take: 21 });
  if (!ids.length) return [];
  if (ids.length > 20) throw new DomainHttpException('TEMPLATE_VALIDATION_FAILED', 'assets: at most 20 references');
  const assets = await tx.$queryRaw<{ id: string }[]>`SELECT a.id FROM design_template_assets a
    JOIN design_template_stored_objects o ON o.key=a."sanitizedKey"
    WHERE a.id IN (${Prisma.join(ids.map((entry) => entry.assetId))}) AND a.state='AVAILABLE' AND o.state='AVAILABLE'
    ORDER BY a.id FOR SHARE OF a,o`;
  if (assets.length !== new Set(ids.map((entry) => entry.assetId)).size) throw new DomainHttpException('TEMPLATE_ASSET_NOT_READY', 'Artwork is not available');
  return readDraftArtwork(tx, draftId);
}

export function artworkDefaultMedia(artwork: TemplateArtwork[], filePath: (assetId: string) => string) {
  const defaults = new Map<BlockType, ContentMedia[]>();
  for (const asset of artwork) {
    const type = asset.slot as BlockType;
    defaults.set(type, [...(defaults.get(type) ?? []), { id: asset.assetId, url: filePath(asset.assetId), kind: asset.kind as 'PHOTO' | 'COVER',
      width: asset.width, height: asset.height, altText: {}, variants: [] }]);
  }
  return defaults;
}
