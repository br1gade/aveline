import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n, type Language } from '@/lib/i18n';

import { block, invitationFixture } from './fixtures';
import { InvitationPage, type InvitationPageProps } from './invitation-page';

class StubObserver {
  observe() {}
  disconnect() {}
}

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
});
