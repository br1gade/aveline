import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { imageSource } from '@/features/invitation-renderer';
import { ROUTE_PATHS } from '@/route-paths';
import { TextLink } from '@/ui';

import { listingHref, priceFrom } from '../listing';
import type { ListingCard as Card } from '../types';

function eventHref(slug: string, language: string): string {
  return `${generatePath(ROUTE_PATHS.publicEvent, { slug })}?locale=${language}`;
}

/**
 * One public event (design PD-103, PD-104): the host's chosen picture, its words as the API gives
 * them, the venue and the lowest price. **No date or time:** the answer gives no zone to show them
 * in (FR-92), and a device's zone would mislead. The event's own page has both.
 */
export function ListingCardView({ card, language }: { card: Card; language: string }) {
  const { t } = useTranslation('public-event');
  const price = priceFrom(card, language, t);
  return (
    <li className="m-0 grid gap-3">
      {card.heroImage ? (
        <img
          {...imageSource(card.heroImage)}
          sizes="(min-width: 40rem) 40rem, 100vw"
          alt={card.heroImage.altText ?? ''}
          loading="lazy"
          className="bg-sand aspect-[4/3] h-auto w-full object-cover"
        />
      ) : null}
      <h2 className="type-heading-1 text-heading m-0">
        <Link
          to={eventHref(card.slug, language)}
          className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-3 hover:decoration-2"
        >
          {card.headline ?? t('untitled')}
        </Link>
      </h2>
      {card.summary ? <p className="m-0">{card.summary}</p> : null}
      {card.venue ? <p className="text-text-muted m-0">{card.venue}</p> : null}
      {price ? <p className="m-0 font-medium">{price}</p> : null}
      {card.categories.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
          {card.categories.map((category) => (
            <li key={category}>
              <TextLink
                href={listingHref({ offset: 0, category })}
                className="inline-flex min-h-11 items-center"
              >
                {category}
              </TextLink>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
