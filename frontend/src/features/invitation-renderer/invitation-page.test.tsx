import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n, type Language } from '@/lib/i18n';
import { saveFile } from '@/ui/save-file';

import { InvitationNotFound } from './components/invitation-not-found';
import { block, invitationFixture, VENUES } from './fixtures';
import { InvitationPage, type InvitationPageProps } from './invitation-page';
import { withPrivateArtwork } from './private-artwork';
import { plantedToken } from '../../../test/tokens';

class StubObserver {
  observe() {}
  disconnect() {}
}

vi.mock('@/ui/save-file', () => ({ saveFile: vi.fn() }));

function renderPage(props: InvitationPageProps, language: Language = 'en') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n(language)}>{children}</I18nextProvider>
  );
  return render(<InvitationPage {...props} />, { wrapper });
}

function headings(level: number): string[] {
  return screen.getAllByRole('heading', { level }).map((heading) => heading.textContent ?? '');
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', StubObserver);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2027-04-30T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('InvitationPage', () => {
  it('has one h1, the hosts, and renders the blocks in the order given', () => {
    const invitation = invitationFixture({
      blocks: [
        block('HERO'),
        block('DRESS_CODE', { content: { body: 'Evening wear' } }),
        block('STORY', { content: { body: 'A few words.' } }),
        block('TIMELINE', { data: [{ label: 'Dinner', occursAt: '2027-06-12T14:00:00.000Z' }] }),
      ],
    });
    renderPage({ invitation });

    expect(headings(1)).toEqual(['Anna & Davit']);
    expect(headings(2)).toEqual(['Dear Armen Petrosyan,', 'Dress code', 'Our story', 'The day']);
  });

  it('renders an unknown block type as nothing', () => {
    const invitation = invitationFixture({
      blocks: [
        block('HERO'),
        block('FIREWORKS', { content: { title: 'Boom' } }),
        block('STORY', { content: { body: 'Still here.' } }),
      ],
    });
    renderPage({ invitation });

    expect(screen.queryByText('Boom')).toBeNull();
    expect(screen.getByText('Still here.')).toBeInTheDocument();
  });

  it('greets the guest by name with their seats, each name whole and the empty seat counted', () => {
    renderPage({ invitation: invitationFixture() });

    const card = screen.getByText('Dear Armen Petrosyan,').closest('article');
    if (!card) throw new Error('no personal card');
    expect(within(card).getByText('Seats reserved: 3')).toBeInTheDocument();
    const names = within(card)
      .getAllByRole('listitem')
      .map((item) => item.textContent?.replace('·', '').trim());
    expect(names).toEqual(['Armen Petrosyan', 'Lusine Petrosyan', '1 seat to name']);
    expect(within(card).getByRole('link', { name: 'Reply' })).toHaveAttribute(
      'href',
      '#reply-heading',
    );
  });

  it('shows the generic link no personal card and says how to reply', () => {
    const renderReply = vi.fn(() => <p>form</p>);
    renderPage({ invitation: invitationFixture({ guest: null }), renderReply });

    expect(screen.queryByText(/Dear /)).toBeNull();
    expect(screen.getByText('To reply, open the personal link you received.')).toBeInTheDocument();
    expect(renderReply).not.toHaveBeenCalled();
  });

  it('fills the reply section from the route on a personal link', () => {
    renderPage({ invitation: invitationFixture(), renderReply: () => <p>the reply form</p> });

    const section = document.getElementById('reply');
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText('the reply form')).toBeInTheDocument();
  });

  it('puts the route’s own parts in the personal card and after the letter (PD-63, PD-64)', () => {
    renderPage({
      invitation: invitationFixture(),
      renderPersonal: () => <button type="button">Correct my name</button>,
      renderContributions: () => <h2>Photos from guests</h2>,
    });

    const card = screen.getByRole('heading', { name: 'Dear Armen Petrosyan,' }).closest('article');
    expect(within(card as HTMLElement).getByRole('button', { name: 'Correct my name' }));
    const main = screen.getByRole('main');
    const last = main.lastElementChild;
    expect(last?.tagName).toBe('SECTION');
    expect(within(last as HTMLElement).getByRole('heading', { name: 'Photos from guests' }));
  });

  it('leaves both parts off a generic link', () => {
    const renderPersonal = vi.fn(() => <p>name</p>);
    const renderContributions = vi.fn(() => <p>photos</p>);
    renderPage({
      invitation: invitationFixture({ guest: null }),
      renderPersonal,
      renderContributions,
    });

    expect(renderPersonal).not.toHaveBeenCalled();
    expect(renderContributions).not.toHaveBeenCalled();
  });

  it('shows the guest’s table at each venue and who of the household sits apart (PD-71)', () => {
    const guest = invitationFixture().guest;
    if (!guest) throw new Error('no guest');
    const own = [
      {
        venueId: 'v1',
        venue: 'Reception',
        table: 'Table 4',
        isReservation: false,
        arrangementId: 'a1',
        tableId: 't4',
        position: null,
      },
      { venueId: null, venue: null, table: 'Garden 1', isReservation: true },
    ];
    const seating = {
      table: null,
      assignments: own,
      household: [
        { id: 'guest-1', name: 'Armen Petrosyan', table: null, assignments: own },
        {
          id: 'guest-2',
          name: 'Lusine Petrosyan',
          table: 'Table 5',
          assignments: [
            { venueId: 'v1', venue: 'Reception', table: 'Table 5', isReservation: false },
          ],
        },
      ],
    };
    renderPage({ invitation: invitationFixture({ guest: { ...guest, seating } }) });

    const card = screen.getByRole('heading', { name: 'Dear Armen Petrosyan,' }).closest('article');
    const inCard = within(card as HTMLElement);
    expect(inCard.getByText('Your table')).toBeInTheDocument();
    expect(inCard.getByText('Reception: Table 4')).toBeInTheDocument();
    expect(inCard.getByText('Garden 1, held for you until you answer')).toBeInTheDocument();
    expect(inCard.getByText('Lusine Petrosyan: Reception: Table 5')).toBeInTheDocument();
  });

  it('says the guest has no seat yet when only their household does', () => {
    const guest = invitationFixture().guest;
    if (!guest) throw new Error('no guest');
    const seating = {
      table: null,
      assignments: [],
      household: [
        {
          id: 'guest-2',
          name: 'Lusine Petrosyan',
          table: 'Table 5',
          assignments: [{ venueId: null, venue: null, table: 'Table 5', isReservation: false }],
        },
      ],
    };
    renderPage({ invitation: invitationFixture({ guest: { ...guest, seating } }) });

    expect(screen.getByText('Your table')).toBeInTheDocument();
    expect(screen.getByText('You don’t have a seat yet.')).toBeInTheDocument();
    expect(screen.getByText('Lusine Petrosyan: Table 5')).toBeInTheDocument();
  });

  it('shows no table before the seating is published, for a guest with none, or on the generic link', () => {
    const guest = invitationFixture().guest;
    if (!guest) throw new Error('no guest');
    const { unmount } = renderPage({
      invitation: invitationFixture({ guest: { ...guest, seating: null } }),
    });
    expect(screen.queryByText('Your table')).toBeNull();
    unmount();
    const empty = { table: null, assignments: [], household: [] };
    const second = renderPage({
      invitation: invitationFixture({ guest: { ...guest, seating: empty } }),
    });
    expect(screen.queryByText('Your table')).toBeNull();
    second.unmount();
    renderPage({ invitation: invitationFixture({ guest: null }) });
    expect(screen.queryByText('Your table')).toBeNull();
  });

  it('names a preview’s header and main, to tell them from the app’s, and a guest’s page’s neither', () => {
    const { unmount } = renderPage({
      invitation: invitationFixture({ guest: null, isAcceptingResponses: false, isPreview: true }),
    });
    expect(screen.getByRole('main', { name: 'The invitation, in preview' })).toBeInTheDocument();
    expect(
      screen.getByRole('banner', { name: 'The invitation’s cover, in preview' }),
    ).toBeInTheDocument();
    unmount();
    renderPage({ invitation: invitationFixture() });
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-label');
  });

  it('says a preview collects no replies, in place of the closed notice', () => {
    const renderReply = vi.fn(() => <p>form</p>);
    renderPage({
      invitation: invitationFixture({ guest: null, isAcceptingResponses: false, isPreview: true }),
      renderReply,
    });

    expect(
      screen.getByText('Guests answer here, on their own link. A preview collects no replies.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Replies are closed/)).toBeNull();
    expect(screen.queryByText(/To reply, open/)).toBeNull();
    expect(renderReply).not.toHaveBeenCalled();
  });

  it('says replies are closed, and offers no Reply button', () => {
    renderPage({
      invitation: invitationFixture({ isAcceptingResponses: false }),
      reply: { status: 'ATTENDING', attendingCount: 3, respondedAt: '2027-03-14T10:00:00.000Z' },
    });

    expect(
      screen.getByText('Replies are closed. The details remain here for you.'),
    ).toBeInTheDocument();
    expect(screen.getByText('You’re attending · 3')).toBeInTheDocument();
    expect(screen.getByText('Sent on 14 March 2027')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reply' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Change reply' })).toBeNull();
  });

  it('formats times in the event zone and labels it', () => {
    renderPage({ invitation: invitationFixture() });

    // The cover's date line, and again for screen readers in place of the countdown's numbers.
    expect(screen.getAllByText('Saturday, 12 June 2027')).toHaveLength(2);
    expect(screen.getByText('16:00 · Yerevan time')).toBeInTheDocument();
    expect(screen.getByText('Arrive by 13:45 · Yerevan time')).toBeInTheDocument();
  });

  it('counts down in days, hours and minutes, with no seconds (PD-35)', () => {
    renderPage({ invitation: invitationFixture() });

    expect(screen.getByText('43')).toBeInTheDocument();
    expect(screen.getByText('days')).toBeInTheDocument();
    expect(screen.queryByText(/seconds/)).toBeNull();
  });

  it('hides the countdown once the event has started', () => {
    vi.setSystemTime(new Date('2027-06-12T12:01:00.000Z'));
    renderPage({ invitation: invitationFixture() });

    expect(screen.queryByText('Until the celebration')).toBeNull();
  });

  it('shows swatches as one labelled image and links directions without a referrer', () => {
    renderPage({ invitation: invitationFixture() });

    expect(screen.getByRole('img', { name: 'Suggested colours' }).children).toHaveLength(3);
    const directions = screen.getByRole('link', { name: 'Get directions' });
    expect(directions).toHaveAttribute('rel', 'noreferrer noopener');
    expect(directions).toHaveAttribute('target', '_blank');
  });

  it('uses the language the response names', () => {
    renderPage({ invitation: invitationFixture({ locale: 'ru' }) }, 'ru');

    expect(screen.getByText('Забронировано мест: 3')).toBeInTheDocument();
    expect(screen.getAllByText('Суббота, 12 июня 2027 г.').length).toBeGreaterThan(0);
  });

  it('renders French when the response names it, and offers the event’s languages', () => {
    renderPage(
      {
        invitation: invitationFixture({ locale: 'fr', availableLocales: ['fr', 'en'] }),
        languageHref: (language) => `?locale=${language}`,
      },
      'fr',
    );

    // The no-break space before the colon reads as a space once Testing Library normalises text.
    expect(screen.getByText('Places réservées : 3')).toBeInTheDocument();
    expect(screen.getAllByText('Samedi 12 juin 2027').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'English', hidden: true })).toHaveAttribute(
      'href',
      '?locale=en',
    );
  });

  it('names the venue of a timeline entry that has one', () => {
    renderPage({ invitation: invitationFixture() });

    const entry = screen.getByText('Ceremony', { selector: 'li span' });
    expect(entry).toHaveTextContent('CeremonyChapel of the Garden');
    expect(screen.getByText('Dinner', { selector: 'li span' })).toHaveTextContent(/^Dinner$/);
  });

  it('offers the event’s other languages on a personal link too', () => {
    renderPage({
      invitation: invitationFixture(),
      languageHref: (language) => `?locale=${language}`,
    });

    expect(screen.getByRole('link', { name: 'Հայերեն' })).toHaveAttribute('href', '?locale=hy');
  });
});

describe('add to calendar (C-32, PD-178)', () => {
  it('saves one event from the venues, in UTC, holding no link to the invitation', async () => {
    const invitation = invitationFixture({ blocks: [block('VENUE', { data: VENUES })] });
    renderPage({ invitation });
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    const [blob, name] = vi.mocked(saveFile).mock.calls[0] ?? [];
    expect(name).toBe('event.ics');
    expect(blob?.type).toBe('text/calendar;charset=utf-8');
    const file = (await blob?.text()) ?? '';
    expect(file).toContain('SUMMARY:Anna & Davit\r\n');
    expect(file).toContain('DTSTART:20270612T120000Z\r\n');
    expect(file).toContain('DTSTAMP:20270430T120000Z\r\n');
    expect(file).toContain(`LOCATION:${VENUES[0]?.name ?? ''}`);
    expect(file).not.toMatch(/https?:|\/g\//);
  });

  it('offers none where no venue block is shown', () => {
    renderPage({ invitation: invitationFixture({ blocks: [block('HERO')] }) });
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).toBeNull();
  });
});

describe('InvitationNotFound', () => {
  it('says so in every interface language, English first', () => {
    const { container } = render(
      <I18nextProvider i18n={createI18n('en')}>
        <InvitationNotFound />
      </I18nextProvider>,
    );

    const languages = [...container.querySelectorAll('main > [lang]')].map((node) =>
      node.getAttribute('lang'),
    );
    expect(languages).toEqual(['en', 'hy', 'ru', 'fr']);
    expect(container.querySelector('[lang="fr"]')).toHaveTextContent(
      'Cette invitation n’est pas disponible.',
    );
  });
});

describe('private artwork on the page', () => {
  const token = plantedToken();

  const withArtwork = () =>
    withPrivateArtwork(
      invitationFixture({
        coverUrl: `/api/v1/invitations/a/g/${token}/design-assets/cover/file`,
        blocks: [
          block('HERO', {
            media: [
              {
                id: 'art',
                url: `/api/v1/invitations/a/g/${token}/design-assets/art/file`,
                kind: 'COVER',
                altText: 'The arch',
                width: 800,
                height: 1000,
              },
            ],
          }),
        ],
      }),
    );

  it('holds no address with the token, in the HTML the server would send', () => {
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <InvitationPage invitation={withArtwork()} />
      </I18nextProvider>,
    );
    expect(html).not.toContain(token);
    expect(html).not.toContain('design-assets');
  });

  it('reads it through the loader the route gives, once near the screen, and shows it from memory', async () => {
    vi.useRealTimers();
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:art');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const artwork = vi.fn(() => Promise.resolve(new Blob(['x'])));
    renderPage({ invitation: withArtwork(), artwork });
    await vi.waitFor(() =>
      expect(screen.getByRole('img', { name: 'The arch' })).toHaveAttribute('src', 'blob:art'),
    );
    expect(artwork).toHaveBeenCalledWith({ id: 'art' }, expect.any(AbortSignal));
    expect(document.body.innerHTML).not.toContain(token);
  });

  it('stands without it when it can’t be read', async () => {
    vi.useRealTimers();
    vi.stubGlobal('IntersectionObserver', undefined);
    renderPage({ invitation: withArtwork(), artwork: () => Promise.reject(new Error('gone')) });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('the full-bleed cover', () => {
  const photo = {
    id: 'p',
    url: 'https://media.example/cover.jpg',
    kind: 'COVER',
    altText: 'The two of them',
    width: 1600,
    height: 2000,
  };

  it('fills the header with the photograph, with no arch', () => {
    renderPage({
      invitation: invitationFixture({
        blocks: [block('HERO', { variant: 'full-bleed', media: [photo] })],
      }),
    });
    const picture = screen.getByRole('img', { name: 'The two of them' });
    expect(picture).toHaveAttribute('loading', 'eager');
    expect(picture).toHaveClass('absolute');
    expect(picture.parentElement?.tagName).toBe('HEADER');
    expect(document.querySelector('.rounded-t-full')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('sets every word on it over the scrim, in ivory or blush, never taupe', () => {
    renderPage({
      invitation: invitationFixture({
        blocks: [
          block('HERO', {
            variant: 'full-bleed',
            media: [photo],
            content: { subtitle: 'invite you' },
          }),
        ],
      }),
    });
    const scrim = screen.getByRole('heading', { level: 1 }).closest('.bg-burgundy-deep\\/65');
    expect(scrim).not.toBeNull();
    expect(screen.getByText('invite you')).toHaveClass('text-ivory');
    expect(screen.getByText('invite you')).not.toHaveClass('text-text-muted');
  });

  it('falls back to the names alone with no photograph, as any cover does', () => {
    renderPage({
      invitation: invitationFixture({
        blocks: [block('HERO', { variant: 'full-bleed', media: [] })],
      }),
    });
    expect(document.querySelector('.bg-burgundy-deep\\/65')).toBeNull();
  });

  it('draws the arch for any other layout', () => {
    renderPage({
      invitation: invitationFixture({
        blocks: [block('HERO', { variant: 'arch', media: [photo] })],
      }),
    });
    expect(document.querySelector('.rounded-t-full')).not.toBeNull();
  });
});
