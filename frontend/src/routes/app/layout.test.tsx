import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, Link } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';
import { useLeaveGuard } from '@/ui/app-form';

import AppLayout, { shouldRevalidate } from './layout';

// The frame's header needs a session; what is tested here is what the layout puts around a page.
vi.mock('@/features/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AppShell: ({ children }: { children: ReactNode }) => children,
}));

function Page() {
  const form = useForm({ defaultValues: { name: '' } });
  useLeaveGuard(form);
  return (
    <>
      <label>
        Name
        <input {...form.register('name')} />
      </label>
      <Link to="/app/elsewhere">Elsewhere</Link>
    </>
  );
}

describe('the app’s frame', () => {
  it('asks before a page with unsaved changes is left', async () => {
    const Stub = createRoutesStub([
      {
        path: '/app',
        Component: AppLayout,
        children: [
          { path: 'page', Component: Page },
          { path: 'elsewhere', Component: () => <h1>Elsewhere</h1> },
        ],
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/app/page']} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});

describe('when the frame reads its organization again', () => {
  const change = (from: string, to: string) =>
    shouldRevalidate({
      currentUrl: new URL(`http://app.test${from}`),
      nextUrl: new URL(`http://app.test${to}`),
      defaultShouldRevalidate: false,
    } as Parameters<typeof shouldRevalidate>[0]);

  it('reads it on leaving the chooser, as a choice was just made', () => {
    expect(change('/app/organizations', '/app/billing')).toBe(true);
  });

  it('keeps it on a move between other pages, and on a search', () => {
    expect(change('/app/billing', '/app')).toBe(false);
    expect(change('/app/events/e1/guests', '/app/events/e1/guests?q=ani')).toBe(false);
  });
});
