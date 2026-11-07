import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';
import { organizationChoice } from '@/api/session';
import { EventUnavailable } from '@/features/events';
import { createI18n } from '@/lib/i18n';

import { ChooseOrganization } from './components/choose-organization';

afterEach(() => organizationChoice.clear());

const organizations = [
  { organizationId: 'a', name: 'Petrosyan Wedding', role: 'OWNER' },
  { organizationId: 'b', name: 'Ani Events', role: 'SOMETHING_NEW' },
];

function open() {
  const Stub = createRoutesStub([
    {
      path: '/app/organizations',
      Component: () => (
        <ChooseOrganization organizations={organizations} currentId="a" next="/app/promo-codes" />
      ),
    },
    { path: '/app/promo-codes', Component: () => <h1>Promo codes</h1> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/organizations']} />
    </I18nextProvider>,
  );
}

function refusal(code: string, status: number) {
  return new ApiError({
    status,
    messages: ['organizationId: refused'],
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

function openUnavailable(error: unknown) {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <EventUnavailable error={error} /> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub />
    </I18nextProvider>,
  );
}

describe('choosing an organization', () => {
  it('lists each with its role, marks the current, and goes on once chosen', async () => {
    open();
    const current = await screen.findByRole('button', { name: /Petrosyan Wedding/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveTextContent('Owner');
    const other = screen.getByRole('button', { name: /Ani Events/ });
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).not.toHaveTextContent('SOMETHING_NEW');

    await userEvent.click(other);

    expect(organizationChoice.read()).toBe('b');
    expect(await screen.findByRole('heading', { name: 'Promo codes' })).toBeInTheDocument();
  });

  it('leaves no separator for a role it has no word for', async () => {
    open();
    const other = await screen.findByRole('button', { name: /Ani Events/ });
    expect(other).not.toHaveTextContent('·');
  });
});

describe('a refusal that choosing answers', () => {
  it.each([
    ['ORGANIZATION_SELECTION_REQUIRED', 409],
    ['ORGANIZATION_CONTEXT_MISMATCH', 409],
  ])('%s links to the chooser', async (code, status) => {
    openUnavailable(refusal(code, status));
    expect(await screen.findByRole('link', { name: 'Choose an organization' })).toHaveAttribute(
      'href',
      '/app/organizations',
    );
  });

  it('a choice no longer held links to the chooser', async () => {
    organizationChoice.choose('gone');
    openUnavailable(refusal('ORGANIZATION_ACCESS_DENIED', 403));
    expect(await screen.findByRole('link', { name: 'Choose an organization' })).toBeInTheDocument();
  });

  it('no membership and no choice does not offer one', async () => {
    openUnavailable(refusal('ORGANIZATION_ACCESS_DENIED', 403));
    expect(await screen.findByRole('link', { name: 'Your events' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Choose an organization' })).not.toBeInTheDocument();
  });
});
