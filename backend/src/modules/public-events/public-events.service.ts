import { Injectable, NotFoundException } from '@nestjs/common';
import { EventVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { negotiateLocale, resolveTranslation } from '../../common/locale';

const listingInclude = {
  event: {
    include: {
      venues: { orderBy: { sortOrder: 'asc' } },
      ticketTypes: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
    },
  },
} satisfies Prisma.EventListingInclude;

@Injectable()
export class PublicEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Browseable announcements. Only PUBLIC events appear — UNLISTED ones are
   * reachable by URL but deliberately absent from every listing, which is the
   * entire point of that visibility.
   */
  async list(params: { locale?: string; category?: string; limit?: number }) {
    const listings = await this.prisma.eventListing.findMany({
      where: {
        publishedAt: { not: null, lte: new Date() },
        event: { visibility: EventVisibility.PUBLIC, status: 'PUBLISHED' },
        ...(params.category ? { categories: { has: params.category } } : {}),
      },
      include: listingInclude,
      orderBy: { event: { startsAt: 'asc' } },
      take: Math.min(params.limit ?? 20, 100),
    });

    return listings.map((listing) => this.summarize(listing, params.locale));
  }

  async findBySlug(slug: string, requestedLocale?: string) {
    const listing = await this.prisma.eventListing.findUnique({
      where: { slug },
      include: listingInclude,
    });

    if (!listing?.publishedAt || listing.event.visibility === EventVisibility.PRIVATE) {
      throw new NotFoundException(`No published event at "${slug}"`);
    }

    const { event } = listing;
    const locale = negotiateLocale(requestedLocale, event.locales, event.defaultLocale);
    const t = <T>(c: unknown) => resolveTranslation<T>(c, locale, event.defaultLocale);

    return {
      slug: listing.slug,
      locale,
      availableLocales: event.locales,
      headline: t(listing.headline),
      summary: t(listing.summary),
      body: t(listing.body),
      categories: listing.categories,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      venues: event.venues.map((venue) => ({
        name: venue.name,
        address: venue.address,
        latitude: venue.latitude,
        longitude: venue.longitude,
      })),
      ticketTypes: event.ticketTypes.map((type) => ({
        id: type.id,
        name: t(type.name),
        description: t(type.description),
        priceMinor: type.priceMinor.toString(),
        currency: type.currency,
        // Remaining count, never the raw counters: how many are held is
        // commercially sensitive and of no use to a buyer.
        available: Math.max(0, type.quantityTotal - type.quantitySold - type.quantityReserved),
        minPerOrder: type.minPerOrder,
        maxPerOrder: type.maxPerOrder,
        salesEndAt: type.salesEndAt,
      })),
      /// Everything a client needs to render link previews and robots rules.
      metadata: this.metadataFor(listing, locale),
    };
  }

  /**
   * Link-preview and indexing metadata.
   *
   * This matters more than SEO: these links are shared in chat apps, where
   * the preview is the first thing anyone sees. Indexing is opt-in and an
   * UNLISTED event is never indexable regardless of its flag.
   */
  private metadataFor(
    listing: Prisma.EventListingGetPayload<{ include: typeof listingInclude }>,
    locale: string,
  ) {
    const { event } = listing;
    const t = <T>(c: unknown) => resolveTranslation<T>(c, locale, event.defaultLocale);
    const isIndexable = listing.isIndexable && event.visibility === EventVisibility.PUBLIC;

    return {
      title: t(listing.ogTitle) ?? t(listing.headline),
      description: t(listing.ogDescription) ?? t(listing.summary),
      imageAssetId: listing.ogImageId ?? listing.heroAssetId,
      locale,
      alternateLocales: event.locales.filter((candidate) => candidate !== locale),
      canonicalPath: `/events/${listing.slug}`,
      robots: isIndexable ? 'index,follow' : 'noindex,nofollow',
    };
  }

  private summarize(
    listing: Prisma.EventListingGetPayload<{ include: typeof listingInclude }>,
    requestedLocale?: string,
  ) {
    const { event } = listing;
    const locale = negotiateLocale(requestedLocale, event.locales, event.defaultLocale);
    const t = <T>(c: unknown) => resolveTranslation<T>(c, locale, event.defaultLocale);

    const cheapest = event.ticketTypes.reduce<bigint | null>(
      (lowest, type) => (lowest === null || type.priceMinor < lowest ? type.priceMinor : lowest),
      null,
    );

    return {
      slug: listing.slug,
      headline: t(listing.headline),
      summary: t(listing.summary),
      categories: listing.categories,
      startsAt: event.startsAt,
      venue: event.venues[0]?.name ?? null,
      fromPriceMinor: cheapest?.toString() ?? null,
      currency: event.ticketTypes[0]?.currency ?? null,
    };
  }
}
