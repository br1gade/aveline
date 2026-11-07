import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { createI18n, type Language } from '@/lib/i18n';

import { ListingPage } from './components/listing-page';
import { listingHref, priceFrom, readListingQuery } from './listing';
import { publicListingMeta } from './meta';
import { readListing } from './read';

function cardWire(overrides: object = {}) {
  return {
    slug: 'autumn-jazz-night',
    headline: 'Autumn jazz night',
    summary: 'An evening of music.',
    categories: ['concert', 'jazz'],
    heroImage: {
      id: 'm1',
      url: 'https://media.example/hero.jpg',
      kind: 'COVER',
      width: 1600,
      height: 1200,
      variants: [{ url: 'https://media.example/hero-800.jpg', width: 800, height: 600 }],
      altText: 'A stage lit in amber',
    },
    startsAt: '2027-06-12T11:00:00.000Z',
    venue: 'Grand Hall',
    fromPriceMinor: '5000',
    currency: 'AMD',
    ...overrides,
  };
}

function pageWire(items: object[] = [cardWire()], overrides: object = {}) {
  return { items, total: items.length, limit: 20, offset: 0, hasMore: false, ...overrides };
}

function query(search: string) {
  return readListingQuery(new URLSearchParams(search));
}

describe('the listing, as read', () => {
  it('keeps what a card shows, in the API’s order', () => {
    const page = readListing(pageWire([cardWire(), cardWire({ slug: 'b' })]));
    expect(page.cards.map((card) => card.slug)).toEqual(['autumn-jazz-night', 'b']);
    expect(page.cards[0]).toMatchObject({
      headline: 'Autumn jazz night',
      summary: 'An evening of music.',
      categories: ['concert', 'jazz'],
      venue: 'Grand Hall',
      fromPriceMinor: '5000',
      currency: 'AMD',
    });
    expect(page.cards[0]?.heroImage).toMatchObject({
      url: 'https://media.example/hero.jpg',
      altText: 'A stage lit in amber',
    });
  });

  it('does not keep the start, which arrives without a zone to show it in (FR-92)', () => {
    expect(JSON.stringify(readListing(pageWire()))).not.toContain('2027-06-12');
  });

  it('reads a card with nothing optional', () => {
    const card = readListing(
      pageWire([
        cardWire({
          headline: null,
          summary: null,
          categories: [],
          heroImage: null,
          venue: null,
          fromPriceMinor: null,
          currency: null,
        }),
      ]),
    ).cards[0];
    expect(card).toMatchObject({
      headline: null,
      heroImage: null,
      venue: null,
      fromPriceMinor: null,
    });
  });

  it.each([[1], [''], [undefined]])(
    'leaves out a card whose slug is %o: it links nowhere',
    (slug) => {
      expect(readListing(pageWire([cardWire({ slug })])).cards).toEqual([]);
    },
  );

  it('reads a price that isn’t a string as none, never as a number', () => {
    const [card] = readListing(pageWire([cardWire({ fromPriceMinor: 5000 })])).cards;
    expect(card?.fromPriceMinor).toBeNull();
  });

  it('drops anything else', () => {
    const secret = crypto.randomUUID();
    expect(JSON.stringify(readListing(pageWire([cardWire({ secret })])))).not.toContain(secret);
  });
});

describe('the address’s query', () => {
  it.each([
    ['', 0],
    ['offset=20', 20],
    ['offset=-1', 0],
    ['offset=abc', 0],
    ['offset=1.5', 0],
    ['offset=99999999999999999999', 0],
    // Past a 32-bit integer the database would refuse it, which would be a 500.
    ['offset=2147483647', 2147483647],
    ['offset=2147483648', 0],
  ])('reads “%s” as offset %i, never a 400', (search, offset) => {
    expect(query(search).offset).toBe(offset);
  });

  it.each([
    ['', undefined],
    ['category=', undefined],
    ['category=%20%20', undefined],
    ['category=concert', 'concert'],
    [`category=${'x'.repeat(64)}`, 'x'.repeat(64)],
    [`category=${'x'.repeat(65)}`, undefined],
    // The database refuses a control character in text, which would be a 500.
    ['category=a%00b', undefined],
    ['category=a%0Ab', undefined],
  ])('reads “%s” as category %s, never a 400', (search, category) => {
    expect(query(search).category).toBe(category);
  });

  it('builds addresses that keep what they should', () => {
    expect(listingHref({ offset: 0 })).toBe('/events');
    expect(listingHref({ offset: 20 })).toBe('/events?offset=20');
    expect(listingHref({ offset: 0, category: 'a b' })).toBe('/events?category=a+b');
    expect(listingHref({ offset: 20, category: 'jazz', language: 'hy' })).toBe(
      '/events?lang=hy&category=jazz&offset=20',
    );
  });
});

describe('the price on a card', () => {
  const t = createI18n('en').getFixedT('en', 'public-event');

  it('says what the cheapest ticket costs', () => {
    expect(priceFrom({ fromPriceMinor: '5000', currency: 'AMD' }, 'en', t)).toContain('5,000');
    expect(priceFrom({ fromPriceMinor: '5000', currency: 'AMD' }, 'en', t)).toMatch(/^From /);
  });

  it('never parses money with a float', () => {
    const huge = '90071992547409931';
    expect(priceFrom({ fromPriceMinor: huge, currency: 'AMD' }, 'en', t)).toContain(
      '90,071,992,547,409,931',
    );
  });

  it('says free tickets exist rather than “from free”', () => {
    expect(priceFrom({ fromPriceMinor: '0', currency: 'AMD' }, 'en', t)).toBe('Free tickets');
  });

  it('says nothing without a price', () => {
    expect(priceFrom({ fromPriceMinor: null, currency: null }, 'en', t)).toBeNull();
    expect(priceFrom({ fromPriceMinor: '5000', currency: null }, 'en', t)).toBeNull();
  });

  it('works in Armenian, which Chrome has no number data for', () => {
    const hy = createI18n('hy').getFixedT('hy', 'public-event');
    expect(priceFrom({ fromPriceMinor: '5000', currency: 'AMD' }, 'hy', hy)).toMatch(/5\s000\s֏/);
  });
});

describe('the page’s head', () => {
  it('is titled in the page’s language, and left out of search engines’ indexes', () => {
    expect(publicListingMeta('en')).toEqual(
      expect.arrayContaining([
        { title: 'Public events · Aveline' },
        { name: 'robots', content: 'noindex,follow' },
      ]),
    );
    expect(publicListingMeta('ru')).toContainEqual({ title: 'Открытые события · Aveline' });
  });
});

function renderPage(wire: object, options: { search?: string; language?: Language } = {}) {
  const language = options.language ?? 'en';
  const props = {
    listing: readListing(wire),
    language,
    query: query(options.search ?? ''),
  };
  const Stub = createRoutesStub([{ path: '/events', Component: () => <ListingPage {...props} /> }]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/events']} />
    </I18nextProvider>,
  );
}

describe('the listing’s page', () => {
  it('shows each card with its picture, link and words, in the page’s language', async () => {
    renderPage(pageWire());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Public events' }),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Autumn jazz night' });
    expect(link).toHaveAttribute('href', '/events/autumn-jazz-night?locale=en');
    expect(screen.getByRole('img', { name: 'A stage lit in amber' })).toHaveAttribute(
      'src',
      expect.stringContaining('media.example'),
    );
    expect(screen.getByText('An evening of music.')).toBeInTheDocument();
    expect(screen.getByText('Grand Hall')).toBeInTheDocument();
    expect(screen.getByText(/From .*5,000/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'jazz' })).toHaveAttribute(
      'href',
      '/events?category=jazz',
    );
  });

  it('says no date is on a card, and where to find it, rather than guessing a zone', async () => {
    renderPage(pageWire());
    expect(await screen.findByText(/soonest first/)).toHaveTextContent('page gives its date');
    expect(document.body.textContent).not.toMatch(/2027|June/);
  });

  it('names a card without a headline, and leaves out what it lacks', async () => {
    renderPage(
      pageWire([
        cardWire({
          headline: null,
          summary: null,
          categories: [],
          heroImage: null,
          venue: null,
          fromPriceMinor: null,
          currency: null,
        }),
      ]),
    );
    expect(await screen.findByRole('link', { name: 'An event' })).toBeInTheDocument();
    expect(document.querySelector('img[src*="media.example"]')).toBeNull();
  });

  it('says so when nothing is listed', async () => {
    renderPage(pageWire([]));
    expect(await screen.findByText('No public events are listed right now.')).toBeInTheDocument();
  });

  it('offers all events when a category shows nothing', async () => {
    renderPage(pageWire([]), { search: 'category=opera' });
    expect(await screen.findByText(/Nothing is listed under “opera”/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all events' })).toHaveAttribute(
      'href',
      '/events',
    );
  });

  it('offers the start from past the end', async () => {
    renderPage(pageWire([], { total: 3, offset: 40 }), { search: 'offset=40' });
    expect(await screen.findByText('There are no more events here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the first events' })).toHaveAttribute(
      'href',
      '/events',
    );
  });

  it('links on and back, keeping the category', async () => {
    renderPage(pageWire([cardWire()], { total: 60, offset: 20, hasMore: true }), {
      search: 'offset=20&category=jazz',
    });
    const paging = await screen.findByRole('navigation', { name: 'More events' });
    expect(within(paging).getByRole('link', { name: 'Later events' })).toHaveAttribute(
      'href',
      '/events?category=jazz&offset=40',
    );
    expect(within(paging).getByRole('link', { name: 'Earlier events' })).toHaveAttribute(
      'href',
      '/events?category=jazz',
    );
  });

  it('offers no way back from the first page', async () => {
    renderPage(pageWire([cardWire()], { total: 60, hasMore: true }));
    const paging = await screen.findByRole('navigation', { name: 'More events' });
    expect(within(paging).getByRole('link', { name: 'Later events' })).toBeInTheDocument();
    expect(within(paging).queryByRole('link', { name: 'Earlier events' })).not.toBeInTheDocument();
  });

  it('offers no way on from the last page', async () => {
    renderPage(pageWire([cardWire()], { total: 21, offset: 20, hasMore: false }), {
      search: 'offset=20',
    });
    const paging = await screen.findByRole('navigation', { name: 'More events' });
    expect(within(paging).getByRole('link', { name: 'Earlier events' })).toBeInTheDocument();
    expect(within(paging).queryByRole('link', { name: 'Later events' })).not.toBeInTheDocument();
  });

  it('says which category is showing, with the way back to all', async () => {
    renderPage(pageWire(), { search: 'category=jazz' });
    expect(await screen.findByText(/Showing “jazz”/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all events' })).toHaveAttribute(
      'href',
      '/events',
    );
  });

  it('keeps the category when going back from past the end', async () => {
    renderPage(pageWire([]), { search: 'offset=40&category=jazz' });
    expect(await screen.findByRole('link', { name: 'Back to the first events' })).toHaveAttribute(
      'href',
      '/events?category=jazz',
    );
  });

  it('keeps the category and page when the language changes', async () => {
    renderPage(pageWire(), { search: 'offset=20&category=jazz' });
    expect(await screen.findByRole('link', { name: 'Հայերեն' })).toHaveAttribute(
      'href',
      '/events?lang=hy&category=jazz&offset=20',
    );
  });

  it('offers no paging on one page', async () => {
    renderPage(pageWire());
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'More events' })).not.toBeInTheDocument();
  });

  it.each(['hy', 'ru', 'fr'] as const)('is worded in %s', async (language) => {
    renderPage(pageWire(), { language });
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).not.toHaveTextContent('Public events');
    expect(screen.getByRole('link', { name: 'Autumn jazz night' })).toHaveAttribute(
      'href',
      `/events/autumn-jazz-night?locale=${language}`,
    );
  });

  it('holds the card and its picture in the server’s HTML', () => {
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <MemoryRouter initialEntries={['/events']}>
          <ListingPage listing={readListing(pageWire())} language="en" query={query('')} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(html).toContain('Autumn jazz night');
    expect(html).toContain('https://media.example/hero.jpg');
    expect(html).toContain('A stage lit in amber');
  });
});
