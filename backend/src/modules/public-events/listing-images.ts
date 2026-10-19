import { Prisma } from '@prisma/client';
import { resolveTranslation } from '../../common/locale';
import { PrismaService } from '../../prisma/prisma.service';

interface ListingImages {
  eventId: string;
  heroAssetId: string | null;
  ogImageId: string | null;
  event: { defaultLocale: string };
}
const IMAGE_SELECT = { id: true, eventId: true, url: true, kind: true, width: true, height: true, variants: true, altText: true } satisfies Prisma.MediaAssetSelect;
type Image = Prisma.MediaAssetGetPayload<{ select: typeof IMAGE_SELECT }>;
export type ListingImageMap = Map<string, Image>;

/** One batch for the whole browse page, even when every card has two images. */
export async function loadListingImages(prisma: PrismaService, listings: ListingImages[]): Promise<ListingImageMap> {
  const ids = [...new Set(listings.flatMap((listing) => [listing.heroAssetId, listing.ogImageId]).filter((id): id is string => id !== null))];
  if (!ids.length) return new Map();
  const images = await prisma.mediaAsset.findMany({ where: {
    id: { in: ids }, eventId: { in: listings.map((listing) => listing.eventId) }, kind: { in: ['PHOTO', 'COVER', 'LOGO'] },
  }, select: IMAGE_SELECT });
  return new Map(images.map((image) => [image.id, image]));
}

export function listingImage(listing: ListingImages, images: ListingImageMap, id: string | null, locale: string) {
  const image = id ? images.get(id) : null;
  // Check both keys: two listings on one page must never borrow each other's image.
  if (!image || image.eventId !== listing.eventId) return null;
  return { id: image.id, url: image.url, kind: image.kind, width: image.width, height: image.height,
    variants: image.variants, altText: resolveTranslation<string>(image.altText, locale, listing.event.defaultLocale) };
}
