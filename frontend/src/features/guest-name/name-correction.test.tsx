import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';
import { LeaveGuard } from '@/ui/app-form';

import { isUnloadAsked } from '../../../test/unload';

import { NameCorrection, type NameCorrectionProps } from './components/name-correction';

const ORIGIN = 'http://api.test';
const NAME = `${ORIGIN}/api/v1/invitations/:slug/g/:guestToken/name`;
/** Made at run time, so no committed fixture holds a token. */
const LINK = { slug: 'anna-davit', guestToken: `tok-${crypto.randomUUID()}` };

const server = setupServer();
let sent: unknown[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  sent = [];
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

/** Answers the correction with `answer`, keeping each body. */
function answering(answer: (body: Record<string, unknown>) => Response) {
  server.use(
    http.patch(NAME, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push(body);
      return answer(body);
    }),
  );
}

const corrected = (body: Record<string, unknown>) =>
  HttpResponse.json({
    id: 'guest-1',
    firstName: (body.firstName as string | undefined) ?? 'Armen',
    lastName: body.lastName === undefined ? 'Petrosyan' : body.lastName,
    name: 'Armen',
  });

function renderForm(overrides: Partial<NameCorrectionProps> = {}) {
  const props: NameCorrectionProps = {
    saved: { firstName: 'Armen', lastName: 'Petrosyan' },
    link: LINK,
    locale: 'en',
    onCorrected: vi.fn(),
    ...overrides,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n('en')}>{children}</I18nextProvider>
  );
  const view = render(<NameCorrection {...props} />, { wrapper });
  return { ...view, props, user: userEvent.setup() };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Correct my name' }));
}

describe('correcting one’s own name (PD-64)', () => {
  it('asks before a correction typed is lost (PD-146)', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => {
      const Stub = createRoutesStub([
        { path: '/', Component: () => <LeaveGuard>{children}</LeaveGuard> },
      ]);
      return (
        <I18nextProvider i18n={createI18n('en')}>
          <Stub />
        </I18nextProvider>
      );
    };
    render(
      <NameCorrection
        saved={{ firstName: 'Armen', lastName: 'Petrosyan' }}
        link={LINK}
        locale="en"
        onCorrected={vi.fn()}
      />,
      { wrapper },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Correct my name' }));
    expect(isUnloadAsked()).toBe(false);
    await user.type(screen.getByLabelText('First name'), 'x');
    expect(isUnloadAsked()).toBe(true);
  });

  it('opens prefilled, and clears an emptied surname with null', async () => {
    answering(corrected);
    const { user, props, container } = renderForm();
    await open(user);
    expect(screen.getByRole('button', { name: 'Correct my name' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText('First name')).toHaveValue('Armen');
    await user.clear(screen.getByLabelText(/Last name/));
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Your name is saved.'),
    );
    expect(sent).toEqual([{ lastName: null }]);
    expect(props.onCorrected).toHaveBeenCalledWith({
      id: 'guest-1',
      firstName: 'Armen',
      lastName: null,
      name: 'Armen',
    });
    expect(screen.getByRole('status')).toHaveFocus();
    expect(container.innerHTML).not.toContain(LINK.guestToken);
  });

  it('sends nothing when nothing changed, and closes', async () => {
    answering(corrected);
    const { user, props } = renderForm();
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.queryByLabelText('First name')).toBeNull());
    expect(sent).toEqual([]);
    expect(props.onCorrected).not.toHaveBeenCalled();
  });

  it('refuses an empty first name before sending', async () => {
    const { user } = renderForm();
    await open(user);
    await user.clear(screen.getByLabelText('First name'));
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Enter your first name.')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toEqual([]);
  });

  it('puts a 400 under the field it names', async () => {
    answering(() =>
      HttpResponse.json(
        {
          statusCode: 400,
          message: ['lastName must be shorter than or equal to 100 characters'],
          details: [{ field: 'lastName', code: 'TOO_LONG', userMessage: 'Too long' }],
        },
        { status: 400 },
      ),
    );
    const { user } = renderForm();
    await open(user);
    await user.type(screen.getByLabelText(/Last name/), 'yan');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(
      await screen.findByText('This name couldn’t be saved. Check it and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Last name/)).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    [404, 'This link no longer opens your invitation, so your name can’t be changed here.'],
    [429, 'Too many attempts. Please wait a minute and try again.'],
  ])('words a %i', async (status, words) => {
    answering(() => HttpResponse.json({ statusCode: status, message: 'No' }, { status }));
    const { user } = renderForm();
    await open(user);
    await user.type(screen.getByLabelText('First name'), 'a');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('gives a reference for a server failure', async () => {
    answering(() =>
      HttpResponse.json(
        { statusCode: 500, message: 'Boom', requestId: 'req-42' },
        { status: 500, headers: { 'x-request-id': 'req-42' } },
      ),
    );
    const { user } = renderForm();
    await open(user);
    await user.type(screen.getByLabelText('First name'), 'a');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reference: req-42');
  });

  it('puts the focus back on its button when cancelled', async () => {
    const { user } = renderForm();
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Correct my name' })).toHaveFocus();
  });
});

describe('before hydration', () => {
  it('posts, and is not in the server’s page at all: it opens from a button that needs the script', async () => {
    const { user } = renderForm();
    await open(user);
    const form = screen.getByRole('button', { name: 'Save name' }).closest('form');
    expect(form).toHaveAttribute('method', 'post');
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <NameCorrection
          saved={{ firstName: 'Armen', lastName: null }}
          link={LINK}
          locale="en"
          onCorrected={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(html).not.toContain('<form');
    expect(html).not.toContain(LINK.guestToken);
  });
});
