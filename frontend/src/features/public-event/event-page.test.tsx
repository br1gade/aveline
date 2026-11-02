import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { EventNotFound } from './components/event-not-found';
import { EventPage } from './components/event-page';
import { readPublicEvent } from './read';
import { publicEventWire } from './test-data';

function renderPage(wire = publicEventWire(), isSalesClosed = false) {
  const event = readPublicEvent(wire);
  const Stub = createRoutesStub([
    {
      path: '/events/:slug',
      Component: () => (
        <EventPage
          event={event}
          isSalesClosed={isSalesClosed}
          languageHref={(language) => `?locale=${language}`}
        />
      ),
    },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/events/autumn-jazz-night']} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

describe("a public event's page (PD-78)", () => {
  it("shows the announcement, when in the event's zone, and where", () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Autumn Jazz Night' }),
    ).toBeInTheDocument();
    const when = screen.getByText(/19:00 · Yerevan time/);
    expect(when).toHaveTextContent('Saturday, 2 October 2027');
    expect(screen.getByText('The Garden')).toBeInTheDocument();
    expect(screen.getByText('Doors open at seven.')).toBeInTheDocument();
    expect(screen.getByText('The band starts at eight.')).toBeInTheDocument();
  });

  it('lists each ticket with its price, what is left and when its sales end', () => {
    renderPage();
    const items = within(screen.getByRole('region', { name: 'Tickets' })).getAllByRole('listitem');
    expect(within(items[0]!).getByText('Free')).toBeInTheDocument();
    expect(within(items[1]!).getByText(/15,000/)).toBeInTheDocument();
    expect(within(items[1]!).getByText('Only 3 left')).toBeInTheDocument();
    expect(
      within(items[1]!).getByText(/On sale until Saturday, 2 October 2027, 00:00/),
    ).toBeInTheDocument();
  });

  it('goes on to checkout with the chosen tickets and the language in the address', async () => {
    const { user } = renderPage();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText('Choose how many tickets you want first.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('How many: General'), '2');
    await user.selectOptions(screen.getByLabelText('How many: Table'), '1');
    expect(screen.getByRole('link', { name: 'Continue with 3 tickets' })).toHaveAttribute(
      'href',
      '/events/autumn-jazz-night/checkout?tickets=general.2%2Ctable.1&locale=en',
    );
  });

  it('offers no quantity for a ticket that is sold out', () => {
    const types = publicEventWire().ticketTypes as Array<Record<string, unknown>>;
    renderPage(publicEventWire({ ticketTypes: [{ ...types[1], available: 0 }] }));
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('sells nothing once the event has started', () => {
    renderPage(publicEventWire(), true);
    expect(screen.getByText('Ticket sales closed when the event started.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('says in four languages that an address opens no event', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <EventNotFound />
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { name: 'This event isn’t available' })).toBeInTheDocument();
    expect(screen.getByText('Այս միջոցառումը հասանելի չէ։')).toHaveAttribute('lang', 'hy');
    expect(screen.getByText('Это мероприятие недоступно.')).toHaveAttribute('lang', 'ru');
    expect(screen.getByText('Cet événement n’est pas disponible.')).toHaveAttribute('lang', 'fr');
  });
});
