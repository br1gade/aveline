import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, Link } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';
import { LeaveGuard } from '@/ui/app-form';

import { isUnloadAsked } from '../../../test/unload';
import { PrivacyNoticePage } from './components/privacy-notice-page';
import { PrivacyRequestPage } from './components/privacy-request-page';
import { privacyNoticeMeta, privacyRequestMeta } from './meta';

const ORIGIN = 'http://api.test';
const REQUESTS = `${ORIGIN}/api/v1/privacy/requests`;
const ADDRESS = 'ani@example.am';
const server = setupServer();
const bodies: unknown[] = [];

/** The backend's answer, whose words the page never repeats: they differ from ours in no way. */
function recorded(extra: Record<string, unknown> = {}) {
  return HttpResponse.json(
    {
      kind: 'EXPORT',
      status: 'RECEIVED',
      dueAt: '2026-12-04T21:30:00.000Z',
      message: 'Your request has been recorded.',
      ...extra,
    },
    { status: 201 },
  );
}

function answerWith(reply: () => Response) {
  server.use(
    http.post(REQUESTS, async ({ request }) => {
      bodies.push(await request.json());
      return reply();
    }),
  );
}

function refusal(status: number, message: string) {
  return HttpResponse.json(
    { statusCode: status, message, requestId: 'r-1' },
    { status, headers: { 'x-request-id': 'r-1' } },
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  bodies.length = 0;
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function open() {
  const Stub = createRoutesStub([
    {
      path: '/privacy-request',
      Component: () => (
        <LeaveGuard>
          <PrivacyRequestPage />
          <Link to="/elsewhere">Elsewhere</Link>
        </LeaveGuard>
      ),
    },
    { path: '/elsewhere', Component: () => <h1>Elsewhere</h1> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/privacy-request']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const email = () => screen.getByLabelText('Your email address');
const notes = () => screen.getByLabelText('Anything to add (optional)');
const send = () => screen.getByRole('button', { name: 'Send the request' });

describe('asking about one’s data (PD-156)', () => {
  it('posts, so nothing typed can reach the address bar', () => {
    open();
    expect(document.querySelector('form')).toHaveAttribute('method', 'post');
  });

  it('sends the kind chosen and the address, with no notes when none are typed', async () => {
    answerWith(recorded);
    const user = open();
    await user.click(screen.getByRole('radio', { name: 'Erase what is held about me' }));
    await user.type(email(), ADDRESS);
    await user.click(send());
    await screen.findByRole('status');
    expect(bodies).toEqual([{ kind: 'ERASURE', subjectEmail: ADDRESS }]);
  });

  it('asks for a copy unless told otherwise, and sends notes as typed', async () => {
    answerWith(recorded);
    const user = open();
    await user.type(email(), ADDRESS);
    await user.type(notes(), 'From the Petrosyan wedding');
    await user.click(send());
    await screen.findByRole('status');
    expect(bodies).toEqual([
      { kind: 'EXPORT', subjectEmail: ADDRESS, notes: 'From the Petrosyan wedding' },
    ]);
  });

  it('answers with the date in Yerevan, where the backend’s day has already turned', async () => {
    answerWith(recorded);
    const user = open();
    await user.type(email(), ADDRESS);
    await user.click(send());
    expect(await screen.findByRole('status')).toHaveTextContent(/by 5 December 2026, Yerevan time/);
  });

  it('says nothing that depends on what is held, and forgets the address', async () => {
    answerWith(() => recorded({ message: 'We found a record for you.' }));
    const user = open();
    await user.type(email(), ADDRESS);
    await user.type(notes(), 'Private words');
    await user.click(send());
    const said = await screen.findByRole('status');
    expect(said).toHaveTextContent('the same whether or not anything is held');
    expect(document.body).not.toHaveTextContent('We found a record');
    expect(document.body).not.toHaveTextContent(ADDRESS);
    expect(email()).toHaveValue('');
    expect(notes()).toHaveValue('');
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain(
      ADDRESS,
    );
  });

  it.each(['', 'not-an-address', `${'a'.repeat(190)}@example.am`])(
    'sends nothing for the address “%s”',
    async (typed) => {
      answerWith(recorded);
      const user = open();
      if (typed) {
        await user.click(email());
        await user.paste(typed);
      }
      await user.click(send());
      expect(await screen.findByText('Type a valid email address.')).toBeInTheDocument();
      expect(bodies).toEqual([]);
    },
  );

  it.each(['анна@пример.рф', 'a!b@example.am', `${'a'.repeat(189)}@example.am`])(
    'leaves “%s” for the backend to judge, as this form is someone’s way to a right',
    async (typed) => {
      answerWith(recorded);
      const user = open();
      await user.click(email());
      await user.paste(typed);
      await user.click(send());
      await screen.findByRole('status');
      expect(bodies).toEqual([{ kind: 'EXPORT', subjectEmail: typed }]);
    },
  );

  it('keeps its page out of search results', () => {
    expect(privacyRequestMeta('en')).toContainEqual({
      name: 'robots',
      content: 'noindex,follow',
    });
  });

  it('holds notes to 2,000 characters, at the limit and past it', async () => {
    answerWith(recorded);
    const user = open();
    await user.type(email(), ADDRESS);
    await user.click(notes());
    await user.paste('x'.repeat(2001));
    await user.click(send());
    expect(await screen.findByText('Keep it to 2,000 characters.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
    await user.keyboard('{Backspace}');
    await user.click(send());
    await screen.findByRole('status');
    expect(bodies).toHaveLength(1);
  });

  it('puts the backend’s refusal of the address on the field', async () => {
    answerWith(() => refusal(400, 'subjectEmail must be an email'));
    const user = open();
    await user.type(email(), ADDRESS);
    await user.click(send());
    expect(await screen.findByText('Type a valid email address.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('words any other refusal, keeping what was typed', async () => {
    answerWith(() => refusal(400, 'notes must be shorter'));
    const user = open();
    await user.type(email(), ADDRESS);
    await user.click(send());
    expect(await screen.findByRole('alert')).toHaveTextContent('wasn’t accepted');
    expect(email()).toHaveValue(ADDRESS);
  });

  it('gives a reference when the server fails, and can be sent again', async () => {
    let attempts = 0;
    answerWith(() => {
      attempts += 1;
      return attempts === 1 ? refusal(500, 'Boom') : recorded();
    });
    const user = open();
    await user.type(email(), ADDRESS);
    await user.click(send());
    expect(await screen.findByRole('alert')).toHaveTextContent('r-1');
    await waitFor(() => expect(send()).toBeEnabled());
    await user.click(send());
    await screen.findByRole('status');
    expect(bodies).toHaveLength(2);
  });

  it('asks before what is typed is lost, and not once it is sent', async () => {
    answerWith(recorded);
    const user = open();
    expect(isUnloadAsked()).toBe(false);
    await user.type(email(), ADDRESS);
    expect(isUnloadAsked()).toBe(true);
    await user.click(send());
    await screen.findByRole('status');
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
  });
});

describe('the privacy notice, a placeholder until launch (PD-194, C-50)', () => {
  function showNotice(language: 'hy' | 'ru' | 'en' | 'fr') {
    const Stub = createRoutesStub([{ path: '/privacy', Component: PrivacyNoticePage }]);
    render(
      <I18nextProvider i18n={createI18n(language)}>
        <Stub initialEntries={['/privacy']} />
      </I18nextProvider>,
    );
  }

  it.each(['hy', 'ru', 'en', 'fr'] as const)(
    'says first, in %s, that it is a placeholder not to be relied on',
    async (language) => {
      showNotice(language);
      const heading = await screen.findByRole('heading', { level: 1 });
      const warning = heading.nextElementSibling;
      const words = createI18n(language).getFixedT(language, 'privacy-request');
      expect(warning).toHaveTextContent(words('notice.placeholder.title'));
      expect(warning).toHaveTextContent(words('notice.placeholder.body'));
    },
  );

  it('leads to the data-request form', async () => {
    showNotice('en');
    expect(await screen.findByRole('link', { name: 'Ask about your data' })).toHaveAttribute(
      'href',
      '/privacy-request',
    );
  });

  it('is kept out of search results while it is a placeholder', () => {
    expect(privacyNoticeMeta('en')).toContainEqual({ name: 'robots', content: 'noindex,follow' });
  });

  it('is linked from the data-request form', () => {
    open();
    expect(screen.getByRole('link', { name: 'Read the privacy notice' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});
