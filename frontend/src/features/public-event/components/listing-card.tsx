import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { displayDate, displayTime, imageSource } from '@/features/invitation-renderer';
import { ROUTE_PATHS } from '@/route-paths';
import { TextLink } from '@/ui';

import { listingHref, priceFrom } from '../listing';
import type { ListingCard as Card } from '../types';
import { useZoneLabel } from './use-zone-label';

function eventHref(slug: string, language: string): string {
  return `${generatePath(ROUTE_PATHS.publicEvent, { slug })}?locale=${language}`;
}

/** The start in the event's own zone, never the device's, said in the page's language. */
function CardStart({ start, language }: { start: NonNullable<Card['start']>; language: string }) {
  const zone = { timeZone: start.timezone, locale: language };
  const zoneLabel = useZoneLabel(start.startsAt, start.timezone, language);
  return (
    <p className="m-0">
      {displayDate(start.startsAt, zone)}, {displayTime(start.startsAt, zone)} · {zoneLabel}
    </p>
  );
}

/** The host's chosen picture, its description in the card's language. */
function CardPicture({
  image,
  lang,
}: {
  image: NonNullable<Card['heroImage']>;
  lang: string | undefined;
}) {
  return (
    <img
      {...imageSource(image)}
      sizes="(min-width: 40rem) 40rem, 100vw"
      alt={image.altText ?? ''}
      lang={lang}
      loading="lazy"
      className="bg-sand aspect-[4/3] h-auto w-full object-cover"
    />
  );
}

/**
 * One public event (design PD-103): the host's chosen picture, its words as the API gives them,
 * when it starts, the venue and the lowest price. The host's translated words (headline, summary,
 * picture description) carry the language the card names, which may not be the page's (FR-92); the
 * venue is as stored, and what the client words, the date and the price, is in the page's.
 */
export function ListingCardView({ card, language }: { card: Card; language: string }) {
  const { t } = useTranslation('public-event');
  const price = priceFrom(card, language, t);
  const lang = card.locale ?? undefined;
  return (
    <li className="m-0 grid gap-3">
      {card.heroImage ? <CardPicture image={card.heroImage} lang={lang} /> : null}
      <h2 className="type-heading-1 text-heading m-0">
        <Link
          to={eventHref(card.slug, language)}
          lang={card.headline ? lang : undefined}
          className="inline-flex min-h-11 items-center underline decoration-1 underline-offset-3 hover:decoration-2"
        >
          {card.headline ?? t('untitled')}
        </Link>
      </h2>
      {card.start ? <CardStart start={card.start} language={language} /> : null}
      {card.summary ? (
        <p className="m-0" lang={lang}>
          {card.summary}
        </p>
      ) : null}
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
