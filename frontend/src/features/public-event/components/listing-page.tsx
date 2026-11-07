import { useTranslation } from 'react-i18next';

import { LANGUAGES, type Language } from '@/lib/i18n';
import { LanguageSwitcher, Notice, TextLink } from '@/ui';

import { listingHref, type ListingQuery } from '../listing';
import type { PublicListing } from '../types';
import { ListingCardView } from './listing-card';
import { PublicFrame } from './public-frame';

/** At least 44 px tall (frontend/CLAUDE.md §5). */
const TARGET = 'inline-flex min-h-11 items-center';

export interface ListingPageProps {
  listing: PublicListing;
  language: Language;
  query: ListingQuery;
}

/** Why nothing is on screen, with the way to something that is. */
function EmptyListing({ query }: { query: ListingQuery }) {
  const { t } = useTranslation('public-event');
  if (query.offset > 0) {
    return (
      <div className="grid gap-3">
        <Notice>{t('listing.pastTheEnd')}</Notice>
        <TextLink className={TARGET} href={listingHref({ offset: 0, category: query.category })}>
          {t('listing.toStart')}
        </TextLink>
      </div>
    );
  }
  if (query.category) {
    return (
      <div className="grid gap-3">
        <Notice>{t('listing.emptyCategory', { category: query.category })}</Notice>
        <TextLink className={TARGET} href={listingHref({ offset: 0 })}>
          {t('listing.showAll')}
        </TextLink>
      </div>
    );
  }
  return <Notice>{t('listing.empty')}</Notice>;
}

function Paging({ listing, query }: { listing: PublicListing; query: ListingQuery }) {
  const { t } = useTranslation('public-event');
  const { category, offset } = query;
  if (offset === 0 && !listing.hasMore) return null;
  return (
    <nav aria-label={t('listing.paging')} className="flex flex-wrap justify-between gap-4">
      {offset > 0 ? (
        <TextLink
          className={TARGET}
          href={listingHref({ offset: Math.max(0, offset - listing.limit), category })}
        >
          {t('listing.earlier')}
        </TextLink>
      ) : null}
      {listing.hasMore ? (
        <TextLink
          className={TARGET}
          href={listingHref({ offset: offset + listing.limit, category })}
        >
          {t('listing.later')}
        </TextLink>
      ) : null}
    </nav>
  );
}

/**
 * Browsing public events (docs/API.md §5; design PD-103). Rendered on the server, plain links all
 * the way, so it works before and without JavaScript. Only `PUBLIC` events are listed; an unlisted
 * one never is.
 */
export function ListingPage({ listing, language, query }: ListingPageProps) {
  const { t } = useTranslation('public-event');
  return (
    <PublicFrame>
      <header className="grid gap-4">
        <div className="flex justify-end">
          <LanguageSwitcher
            current={language}
            available={LANGUAGES}
            hrefFor={(next) => listingHref({ ...query, language: next })}
            align="end"
          />
        </div>
        <h1 className="type-display-l text-heading m-0">{t('listing.title')}</h1>
        <p className="type-lead m-0">{t('listing.lead')}</p>
        {query.category && listing.cards.length > 0 ? (
          <p className="m-0">
            {t('listing.showing', { category: query.category })}{' '}
            <TextLink className={TARGET} href={listingHref({ offset: 0 })}>
              {t('listing.showAll')}
            </TextLink>
          </p>
        ) : null}
      </header>
      {listing.cards.length === 0 ? (
        <EmptyListing query={query} />
      ) : (
        <ul className="m-0 grid list-none gap-12 p-0">
          {listing.cards.map((card) => (
            <ListingCardView key={card.slug} card={card} language={language} />
          ))}
        </ul>
      )}
      <Paging listing={listing} query={query} />
    </PublicFrame>
  );
}
