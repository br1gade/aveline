import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, Link, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';
import { Dialog, DialogContent, DialogTitle } from '@/ui/kit/dialog';

import { guardedRoutes, isLeavingAsked } from './guarded-routes';
import { LEAVE_UNASKED, useLeaveGuard, useLeaveGuardWhen } from './leave-guard';

type AfterSave = 'reset' | 'navigate' | 'navigate at once' | 'refused';

function NameForm({ label, afterSave = 'reset' }: { label: string; afterSave?: AfterSave }) {
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } });
  useLeaveGuard(form);
  const navigate = useNavigate();
  const save = async (values: { name: string }) => {
    // A save with nothing to send goes on without waiting for any answer.
    if (afterSave === 'navigate at once') return navigate('/elsewhere');
    await Promise.resolve();
    if (afterSave === 'refused') return undefined;
    if (afterSave === 'navigate') await navigate('/elsewhere');
    else form.reset(values);
  };
  return (
    <form onSubmit={form.handleSubmit(save)}>
      <label>
        {label}
        <input {...form.register('name')} />
      </label>
      <button type="submit">Save {label}</button>
    </form>
  );
}

function FormPage({ afterSave }: { afterSave?: AfterSave }) {
  const [isSecondShown, setIsSecondShown] = useState(false);
  return (
    <main>
      <NameForm label="Name" {...(afterSave ? { afterSave } : {})} />
      {isSecondShown ? <NameForm label="Second" /> : null}
      <button type="button" onClick={() => setIsSecondShown((shown) => !shown)}>
        Toggle the second form
      </button>
      <Link to="/elsewhere">Elsewhere</Link>
      <Link to="/form?q=ani">Filter</Link>
      <Link to="/elsewhere" state={LEAVE_UNASKED}>
        Signed out
      </Link>
    </main>
  );
}

function renderGuarded(afterSave?: AfterSave, isGuarded = true) {
  const routes = [
    { path: '/form', Component: () => <FormPage {...(afterSave ? { afterSave } : {})} /> },
    { path: '/elsewhere', Component: () => <h1>Elsewhere</h1> },
  ];
  const Stub = createRoutesStub(isGuarded ? guardedRoutes(routes) : routes);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/form']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const elsewhere = () => screen.findByRole('heading', { name: 'Elsewhere' });

describe('leaving a page with unsaved changes', () => {
  it('goes at once when nothing was typed', async () => {
    const user = renderGuarded();
    await user.click(await screen.findByRole('link', { name: 'Elsewhere' }));
    expect(await elsewhere()).toBeInTheDocument();
  });

  it('asks first, Cancel focused, and Enter keeps what was typed and the focus', async () => {
    const user = renderGuarded();
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    const link = screen.getByRole('link', { name: 'Elsewhere' });
    await user.click(link);
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    expect(dialog).toHaveTextContent('What you changed on this page isn’t saved.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Name')).toHaveValue('Ani');
    await waitFor(() => expect(link).toHaveFocus());
  });

  it('leaves when asked to', async () => {
    const user = renderGuarded();
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave without saving' }));
    expect(await elsewhere()).toBeInTheDocument();
  });

  it('doesn’t ask once the changes are saved', async () => {
    const user = renderGuarded();
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('button', { name: 'Save Name' }));
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await elsewhere()).toBeInTheDocument();
  });

  it('never asks about the page a save goes to', async () => {
    const user = renderGuarded('navigate');
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('button', { name: 'Save Name' }));
    expect(await elsewhere()).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('never asks about the page a save goes to at once, with nothing to send', async () => {
    const user = renderGuarded('navigate at once');
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    // Submitted as a browser does, outside act(), so React re-renders no sooner than it would there.
    screen.getByRole('button', { name: 'Save Name' }).closest('form')?.requestSubmit();
    expect(await elsewhere()).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('still asks after a save that didn’t go through', async () => {
    const user = renderGuarded('refused');
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('button', { name: 'Save Name' }));
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('doesn’t ask about a search on the same page, which keeps the form', async () => {
    const user = renderGuarded();
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('link', { name: 'Filter' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Ani');
  });

  it('asks while any form of the page has changes, and stops when that form is gone', async () => {
    const user = renderGuarded();
    await user.click(await screen.findByRole('button', { name: 'Toggle the second form' }));
    await user.type(screen.getByLabelText('Second'), 'Davit');
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    await user.click(screen.getByRole('button', { name: 'Toggle the second form' }));
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await elsewhere()).toBeInTheDocument();
  });

  it('has the browser ask before a reload or closing the tab, only while there are changes', async () => {
    const user = renderGuarded();
    const field = await screen.findByLabelText('Name');
    expect(isLeavingAsked()).toBe(false);
    await user.type(field, 'Ani');
    await waitFor(() => expect(isLeavingAsked()).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Save Name' }));
    await waitFor(() => expect(isLeavingAsked()).toBe(false));
  });

  it('lets a navigation marked to go unasked through, such as the session’s end', async () => {
    const user = renderGuarded();
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('link', { name: 'Signed out' }));
    expect(await elsewhere()).toBeInTheDocument();
  });

  it('stops listening to a form once it is gone', async () => {
    const unsubscribe = vi.fn();
    const form = { subscribe: vi.fn(() => unsubscribe) };
    function Listening() {
      useLeaveGuard(form);
      return <Link to="/elsewhere">Elsewhere</Link>;
    }
    const Stub = createRoutesStub(
      guardedRoutes([
        { path: '/form', Component: Listening },
        { path: '/elsewhere', Component: () => <h1>Elsewhere</h1> },
      ]),
    );
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/form']} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Elsewhere' }));
    expect(await elsewhere()).toBeInTheDocument();
    expect(unsubscribe).toHaveBeenCalledTimes(form.subscribe.mock.calls.length);
  });

  it('does nothing outside the app’s frame', async () => {
    const user = renderGuarded(undefined, false);
    await user.type(await screen.findByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await elsewhere()).toBeInTheDocument();
  });
});

/** A dialog's form, as the app's are, with the phone's Back pressed while it is open. */
function DialogPage({ isFormDialog }: { isFormDialog: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <main>
      <h1>Dialog page</h1>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open
      </button>
      {isOpen ? (
        <Dialog open onOpenChange={setIsOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Add someone</DialogTitle>
            {isFormDialog ? <NameForm label="Name" /> : <ChoiceForm />}
            <button type="button" onClick={() => void navigate(-1)}>
              Phone back
            </button>
            <button type="button" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  );
}

/** A choice held in the component's state, as the seating and team dialogs hold theirs. */
function ChoiceForm() {
  const [isChosen, setIsChosen] = useState(false);
  useLeaveGuardWhen(isChosen);
  return (
    <label>
      <input type="checkbox" checked={isChosen} onChange={() => setIsChosen(!isChosen)} />
      Chosen
    </label>
  );
}

function renderDialogPage(isFormDialog = true) {
  const Stub = createRoutesStub(
    guardedRoutes([
      { path: '/before', Component: () => <h1>Before</h1> },
      { path: '/dialog', Component: () => <DialogPage isFormDialog={isFormDialog} /> },
    ]),
  );
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/before', '/dialog']} initialIndex={1} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

describe('leaving with a dialog’s form open (design PD-146)', () => {
  it('asks before Back leaves typed work in a dialog, and Cancel keeps the dialog and its work', async () => {
    const user = renderDialogPage();
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('button', { name: 'Phone back' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Add someone' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Ani');
  });

  it('goes back once the dialog is closed without saving', async () => {
    const user = renderDialogPage();
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('Name'), 'Ani');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Phone back' }));
    expect(await screen.findByRole('heading', { name: 'Before' })).toBeInTheDocument();
  });

  it('asks about a choice held in state while it is made, and not once it is undone', async () => {
    const user = renderDialogPage(false);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    expect(isLeavingAsked()).toBe(false);
    await user.click(screen.getByLabelText('Chosen'));
    expect(isLeavingAsked()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Phone back' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    await user.click(screen.getByLabelText('Chosen'));
    expect(isLeavingAsked()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Phone back' }));
    expect(await screen.findByRole('heading', { name: 'Before' })).toBeInTheDocument();
  });

  it('forgets a choice once its dialog is gone', async () => {
    const user = renderDialogPage(false);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.click(screen.getByLabelText('Chosen'));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(isLeavingAsked()).toBe(false);
  });
});
