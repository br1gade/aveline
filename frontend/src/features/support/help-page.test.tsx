import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { HelpPage } from './components/help-page';

function show(language: 'en' | 'hy' = 'en') {
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

afterEach(() => vi.unstubAllEnvs());

describe('the Help page (C-54, PD-180)', () => {
  it('leads to the privacy notice', () => {
    show();
    expect(screen.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('lists every contact set, each leading where it should, and the languages answered in', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'help@example.am');
    vi.stubEnv('VITE_SUPPORT_PHONE', '+37410123456');
    vi.stubEnv('VITE_SUPPORT_WHATSAPP', '+37491123456');
    vi.stubEnv('VITE_SUPPORT_TELEGRAM', 'aveline_help');
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Help and contact' })).toBeVisible();
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('help@example.am')).toBe('mailto:help@example.am');
    expect(href('+37410123456')).toBe('tel:+37410123456');
    expect(href('+37491123456')).toBe('https://wa.me/37491123456');
    expect(href('@aveline_help')).toBe('https://t.me/aveline_help');
    // Leaving the site for a messenger sends no referrer.
    expect(screen.getByRole('link', { name: '@aveline_help' })).toHaveAttribute(
      'rel',
      'noreferrer',
    );
    expect(screen.getByText('We answer in Armenian, Russian and English.')).toBeVisible();
  });

  it('says plainly when no contact is set yet', () => {
    show();
    expect(screen.getByText('Ways to reach us aren’t listed here yet.')).toBeVisible();
    expect(screen.queryByRole('link', { name: /@|\+/ })).toBeNull();
  });
});

describe('the Aveline mark at the foot (C-35)', () => {
  it('is no link until the site is set', () => {
    show();
    expect(screen.queryByRole('link', { name: 'Aveline Events' })).toBeNull();
  });

  it('links to the site once it is, sending no referrer', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://example.am');
    show();
    const mark = screen.getByRole('link', { name: 'Aveline Events' });
    expect(mark).toHaveAttribute('href', 'https://example.am');
    expect(mark).toHaveAttribute('rel', 'noreferrer');
  });
});
