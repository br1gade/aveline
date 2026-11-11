import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { isLeavingAsked } from '@/ui/app-form/guarded-routes';

import { READY_MESSAGE } from './draft-message';
import {
  answer,
  API,
  designWire,
  EVENT,
  libraryWire,
  ORIGIN,
  previewWire,
  refusal,
  serveDesign,
  SLUG,
} from './test-data';
import { renderDesign } from './test-render';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

function session(): BrowserSession {
  if (!current.session) throw new Error('No session in this test');
  return current.session;
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const OVERVIEW = '/app/events/e1/design';

function sectionNames(): string[] {
  const region = screen.getByRole('region', { name: 'Sections of the page' });
  return within(region)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent ?? '');
}

describe('the design overview', () => {
  it('lists the sections in the API’s order, hidden ones too, with what blocks publishing', async () => {
    serveDesign(server);
    renderDesign(session, OVERVIEW);

    await screen.findByRole('heading', { level: 1, name: 'Design the invitation' });
    expect(sectionNames()).toEqual(['Cover', 'Invitation text', 'Venues', 'Reply section']);
    const reply = screen.getByRole('heading', { name: 'Reply section' }).closest('li');
    expect(within(reply as HTMLElement).getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByText(/The reply section is switched off/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show the reply section' })).toHaveAttribute(
      'href',
      '/app/events/e1/design/sections/RSVP',
    );
    expect(screen.getByText('A draft: guests can’t open it yet.')).toBeInTheDocument();
  });

  it('shows a section with one request, then says so with the focus', async () => {
    const reads = serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/blocks/RSVP`);
    const user = renderDesign(session, OVERVIEW);

    await user.click(await screen.findByRole('button', { name: 'Show: Reply section' }));

    const status = await screen.findByText('Reply section is shown to guests.');
    expect(sent).toEqual([{ enabled: true }]);
    expect(reads.design).toBe(2);
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('moves a section by sending the whole order of the sections the template renders', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/arrangement`);
    const user = renderDesign(session, OVERVIEW);

    await user.click(await screen.findByRole('button', { name: 'Move up: Reply section' }));

    await screen.findByText('Reply section moved up.');
    expect(sent).toEqual([
      { blocks: [{ type: 'HERO' }, { type: 'STORY' }, { type: 'RSVP' }, { type: 'VENUE' }] },
    ]);
    expect(screen.queryByRole('button', { name: 'Move up: Cover' })).toBeNull();
  });

  it('adds a section the template renders at the end, shown', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/arrangement`);
    const user = renderDesign(session, OVERVIEW);

    await user.click(await screen.findByRole('button', { name: 'Add: Contact' }));

    await screen.findByText('Contact added at the end of the page.');
    expect(sent).toEqual([
      {
        blocks: [
          { type: 'HERO' },
          { type: 'STORY' },
          { type: 'VENUE' },
          { type: 'RSVP' },
          { type: 'CONTACT', enabled: true },
        ],
      },
    ]);
  });

  it('asks before hiding the reply section of a published invitation', async () => {
    const published = designWire({ status: 'PUBLISHED', publishBlockers: [] });
    published.blocks[3] = { ...published.blocks[3]!, enabled: true };
    serveDesign(server, { design: published });
    const sent = answer(server, 'patch', `/invitations/${SLUG}/blocks/RSVP`);
    const user = renderDesign(session, OVERVIEW);

    expect(await screen.findByText(/Changes you save show on guests’ pages/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide: Reply section' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Hide the reply section?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep it shown' }));
    expect(sent).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Hide: Reply section' }));
    await user.click(await screen.findByRole('button', { name: 'Hide it' }));
    await screen.findByText('Reply section is hidden.');
    expect(sent).toEqual([{ enabled: false }]);
  });

  it('explains a 403 to a role that may read the design but not change it', async () => {
    serveDesign(server);
    answer(server, 'patch', `/invitations/${SLUG}/blocks/RSVP`, refusal(403, 'Forbidden'));
    const user = renderDesign(session, OVERVIEW);

    await user.click(await screen.findByRole('button', { name: 'Show: Reply section' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your role on this event can see the invitation’s design but not change it.',
    );
  });

  it('says so when the event has no invitation', async () => {
    serveDesign(server, { event: { ...EVENT, invitation: null } });
    renderDesign(session, OVERVIEW);

    expect(await screen.findByText(/This event has no invitation to design/)).toBeInTheDocument();
  });
});

describe('a section', () => {
  it('sends only the language changed, over its stored copy, and keeps the others', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/blocks/HERO`);
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');

    const english = await screen.findByRole('group', { name: 'English' });
    await user.type(within(english).getByLabelText('Line under the names'), 'invite you');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    expect(sent).toEqual([{ content: { en: { title: 'Anna & Davit', subtitle: 'invite you' } } }]);
  });

  it('asks before the page is left with a change, and not once it is saved', async () => {
    serveDesign(server);
    answer(server, 'patch', `/invitations/${SLUG}/blocks/HERO`);
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');
    const english = await screen.findByRole('group', { name: 'English' });
    await user.type(within(english).getByLabelText('Line under the names'), 'invite you');
    await waitFor(() => expect(isLeavingAsked()).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(isLeavingAsked()).toBe(false);
  });

  it('removes a language emptied, so its guests fall back to the default language', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/blocks/HERO`);
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');

    const english = await screen.findByRole('group', { name: 'English' });
    await user.clear(within(english).getByLabelText(/^Heading/));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    expect(sent).toEqual([{ content: { en: null } }]);
  });

  it('offers the template’s layouts, and marks the layout a 400 names', async () => {
    serveDesign(server);
    answer(
      server,
      'patch',
      `/invitations/${SLUG}/blocks/HERO`,
      refusal(400, 'variant: HERO has no layout "stacked" in this template; it offers split'),
    );
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');

    const layout = await screen.findByLabelText('Layout');
    expect(
      within(layout)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['The template’s default', 'Full bleed', 'Split', 'Stacked']);
    await user.selectOptions(layout, 'stacked');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This wasn’t accepted. Check it.')).toBeInTheDocument();
    expect(layout).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    ['HERO', /draws Full bleed when the cover has a photograph/],
    ['RSVP', /^The preview can’t draw this template’s layouts yet/],
  ])('says what the preview draws of %s’s layouts', async (type, help) => {
    serveDesign(server);
    renderDesign(session, `/app/events/e1/design/sections/${type}`);
    expect(await screen.findByLabelText('Layout')).toHaveAccessibleDescription(help);
  });

  it('chooses the cover photo from the uploads', async () => {
    serveDesign(server, { library: libraryWire() });
    const sent = answer(server, 'patch', `/invitations/${SLUG}/blocks/HERO`);
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');

    await screen.findByText('Nothing chosen yet.');
    // Pictures only: the audio upload is not offered to the cover.
    expect(screen.getAllByRole('button', { name: /Use upload/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Use upload 1' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    expect(sent).toEqual([{ assetIds: ['m2'] }]);
  });

  it('refuses a chat link that is not a web link, before sending', async () => {
    const design = designWire();
    design.blocks.push({
      type: 'CHAT',
      enabled: true,
      variant: null,
      content: {},
      settings: {},
      assetIds: [],
      media: [],
    });
    serveDesign(server, { design });
    const sent = answer(server, 'patch', `/invitations/${SLUG}/blocks/CHAT`);
    const user = renderDesign(session, '/app/events/e1/design/sections/CHAT');

    const english = await screen.findByRole('group', { name: 'English' });
    await user.type(within(english).getByLabelText(/^Link to the chat/), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Give a web link starting with https:// or http://'),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('offers to add a section the invitation lacks, through the arrangement call', async () => {
    const design = designWire();
    design.blocks = design.blocks.filter((block) => block.type !== 'RSVP');
    serveDesign(server, { design });
    const sent = answer(server, 'patch', `/invitations/${SLUG}/arrangement`);
    const user = renderDesign(session, '/app/events/e1/design/sections/RSVP');

    expect(
      await screen.findByText(/The invitation doesn’t have this section yet/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add the section' }));

    await screen.findByText('Reply section added at the end of the page.');
    expect(sent).toEqual([
      {
        blocks: [
          { type: 'HERO' },
          { type: 'STORY' },
          { type: 'VENUE' },
          { type: 'RSVP', enabled: true },
        ],
      },
    ]);
  });

  it('says where a data-bound section’s facts come from', async () => {
    serveDesign(server);
    renderDesign(session, '/app/events/e1/design/sections/VENUE');

    expect(
      await screen.findByText(/The venues come from the event’s venue list/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the venues' })).toHaveAttribute(
      'href',
      '/app/events/e1/venues',
    );
  });

  it('says why a 403 on saving was refused', async () => {
    serveDesign(server);
    answer(server, 'patch', `/invitations/${SLUG}/blocks/HERO`, refusal(403, 'Forbidden'));
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');

    const english = await screen.findByRole('group', { name: 'English' });
    await user.type(within(english).getByLabelText('Line under the names'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Your role on this event/);
  });
});

describe('a 429 and a server failure', () => {
  it('say so, the failure with its reference', async () => {
    serveDesign(server);
    answer(server, 'patch', `/invitations/${SLUG}/blocks/RSVP`, refusal(429));
    const user = renderDesign(session, OVERVIEW);
    await user.click(await screen.findByRole('button', { name: 'Show: Reply section' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');

    server.use();
    answer(server, 'patch', `/invitations/${SLUG}/blocks/RSVP`, () =>
      HttpResponse.json({ statusCode: 500, message: 'boom', requestId: 'req-9' }, { status: 500 }),
    );
    await user.click(screen.getByRole('button', { name: 'Show: Reply section' }));
    expect(await screen.findByText('Reference: req-9')).toBeInTheDocument();
  });
});

describe('previewing a section’s unsaved edits (PD-153, FR-120)', () => {
  interface Asked {
    locale: string;
    body: Record<string, unknown>;
  }

  /** The backend draws the draft it is sent, in the language asked for; each request is kept. */
  function servePreview(
    reply: (locale: string) => Response | Promise<Response> = (locale) =>
      HttpResponse.json(previewWire(locale)),
  ) {
    const asked: Asked[] = [];
    server.use(
      http.post(`${API}/invitations/${SLUG}/template-preview`, async ({ request }) => {
        const locale = new URL(request.url).searchParams.get('locale') ?? '';
        asked.push({ locale, body: (await request.json()) as Record<string, unknown> });
        return reply(locale);
      }),
    );
    return asked;
  }

  /** The frame says it is ready, as its page does once loaded; what it is then sent is watched. */
  function frameReady() {
    const frame = screen.getByTitle(/as a phone shows it/);
    const framed = frame instanceof HTMLIFrameElement ? frame.contentWindow : null;
    if (!framed) throw new Error('No frame');
    const sent = vi.spyOn(framed, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: READY_MESSAGE,
        origin: window.location.origin,
        source: framed,
      }),
    );
    return { frame, sent };
  }

  const lastDraft = (sent: ReturnType<typeof frameReady>['sent']) =>
    JSON.stringify(sent.mock.calls.at(-1)?.[0] ?? null);

  it('has the backend draw the section as it stands, hidden or not, in a frame of the app’s own', async () => {
    serveDesign(server);
    const asked = servePreview();
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');
    await user.click(await screen.findByRole('button', { name: 'Show the preview' }));
    const { frame, sent } = frameReady();
    expect(frame).toHaveAttribute('src', '/app/events/e1/design/draft-preview');
    await waitFor(() =>
      expect(asked).toEqual([{ locale: 'hy', body: { type: 'HERO', enabled: true } }]),
    );
    await waitFor(() => expect(lastDraft(sent)).toContain('"locale":"hy"'));
    expect(screen.getByText('Showing what is saved.')).toBeInTheDocument();
    // Only ever to the app's own origin, never to whatever the frame might have become.
    expect(sent).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'draft' }),
      window.location.origin,
    );
  });

  it('draws what was typed only when asked to, in the language chosen', async () => {
    serveDesign(server);
    const asked = servePreview();
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');
    await user.click(await screen.findByRole('button', { name: 'Show the preview' }));
    const { sent } = frameReady();
    await user.selectOptions(screen.getByLabelText('Language of the preview'), 'en');
    await waitFor(() => expect(asked.map(({ locale }) => locale)).toEqual(['hy', 'en']));
    const english = screen.getByRole('group', { name: 'English' });
    await user.type(within(english).getByLabelText('Line under the names'), 'invite you');
    expect(
      screen.getByText('The form has changed since. Press “Preview my changes” to see it.'),
    ).toBeInTheDocument();
    expect(asked).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Preview my changes' }));
    await waitFor(() => expect(asked).toHaveLength(3));
    expect(JSON.stringify(asked[2])).toContain('invite you');
    expect(asked[2]).toMatchObject({ locale: 'en', body: { type: 'HERO', enabled: true } });
    await waitFor(() => expect(lastDraft(sent)).toContain('"locale":"en"'));
    expect(screen.getByText('Showing your changes, not yet saved.')).toBeInTheDocument();
  });

  /** The first language's answer waits until the test lets it go; every other answers at once. */
  function holdFirst(late: () => Response) {
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    servePreview(async (locale) => {
      if (locale !== 'hy') return HttpResponse.json(previewWire(locale));
      await held;
      return late();
    });
    return release;
  }

  /** Opens the preview, moves to English while Armenian is still out, then lets Armenian answer. */
  async function answerOutOfOrder(late: () => Response) {
    serveDesign(server);
    const release = holdFirst(late);
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');
    await user.click(await screen.findByRole('button', { name: 'Show the preview' }));
    const { sent } = frameReady();
    await user.selectOptions(screen.getByLabelText('Language of the preview'), 'en');
    await waitFor(() => expect(lastDraft(sent)).toContain('"locale":"en"'));
    release();
    // A later request, answered after the late one was let go.
    await user.click(screen.getByRole('button', { name: 'Preview my changes' }));
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    return sent;
  }

  it('draws only the latest request’s answer, whichever comes back last', async () => {
    const sent = await answerOutOfOrder(() => HttpResponse.json(previewWire('hy')));
    expect(JSON.stringify(sent.mock.calls)).not.toContain('"locale":"hy"');
  });

  it('marks nothing for a refusal of a request since replaced', async () => {
    await answerOutOfOrder(() =>
      HttpResponse.json(
        { statusCode: 400, message: ['variant: must be one the template offers'] },
        { status: 400 },
      ),
    );
    expect(screen.getByLabelText('Layout')).not.toHaveAccessibleDescription(
      expect.stringContaining('This wasn’t accepted. Check it.'),
    );
  });

  it('marks on the form what the backend refused to draw', async () => {
    serveDesign(server);
    servePreview(() =>
      HttpResponse.json(
        { statusCode: 400, message: ['variant: must be one the template offers'] },
        { status: 400 },
      ),
    );
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');
    await user.click(await screen.findByRole('button', { name: 'Show the preview' }));
    expect(
      await screen.findByText(
        'The preview can’t draw what is marked. Change it, then preview again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Layout')).toHaveAccessibleDescription(
      expect.stringContaining('This wasn’t accepted. Check it.'),
    );
  });

  it('says when the preview can’t be read, and leaves the form to edit and save', async () => {
    serveDesign(server);
    servePreview(() => refusal(403)());
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');
    await user.click(await screen.findByRole('button', { name: 'Show the preview' }));
    expect(
      await screen.findByText('The preview couldn’t be loaded. You can still edit and save.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('sends nothing to a frame that a stranger, or the page itself, says is ready', async () => {
    serveDesign(server);
    const asked = servePreview();
    const user = renderDesign(session, '/app/events/e1/design/sections/HERO');
    await user.click(await screen.findByRole('button', { name: 'Show the preview' }));
    const frame = screen.getByTitle(/as a phone shows it/);
    const framed = frame instanceof HTMLIFrameElement ? frame.contentWindow : null;
    if (!framed) throw new Error('No frame');
    const sent = vi.spyOn(framed, 'postMessage');
    const origin = window.location.origin;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: READY_MESSAGE,
        origin: 'https://evil.example',
        source: framed,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', { data: READY_MESSAGE, origin, source: window }),
    );
    await waitFor(() => expect(asked).toHaveLength(1));
    await screen.findByText('Showing what is saved.');
    expect(sent).not.toHaveBeenCalled();
  });

  it('reads nothing until the preview is asked for', async () => {
    serveDesign(server);
    const asked = servePreview();
    renderDesign(session, '/app/events/e1/design/sections/HERO');
    await screen.findByRole('button', { name: 'Show the preview' });
    expect(asked).toEqual([]);
  });
});

describe('a role that may see the design but not change it (FR-6, PD-193)', () => {
  const VIEWER = ['event:read', 'invitation:read'] as const;
  const READ_ONLY = /can see the invitation’s design but not change it/;

  it('is shown the sections with nothing to press, and told why', async () => {
    serveDesign(server);
    renderDesign(session, OVERVIEW, 'en', VIEWER);
    expect(await screen.findByText(READ_ONLY)).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Sections of the page' });
    for (const button of within(region).getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('is shown a section’s words with no saving them', async () => {
    serveDesign(server);
    renderDesign(session, '/app/events/e1/design/sections/HERO', 'en', VIEWER);
    expect(await screen.findByText(READ_ONLY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it.each([
    ['the look', '/app/events/e1/design/look'],
    ['the questions', '/app/events/e1/design/questions'],
    ['the uploads', '/app/events/e1/design/media'],
    ['a new question', '/app/events/e1/design/questions/new'],
  ])('is told so on %s, with nothing to press', async (_page, path) => {
    serveDesign(server);
    server.use(http.get(`${API}/events/e1/media`, () => HttpResponse.json(libraryWire())));
    renderDesign(session, path, 'en', VIEWER);
    expect(await screen.findByText(READ_ONLY)).toBeInTheDocument();
    const inside = screen.queryAllByRole('button').filter((button) => button.closest('fieldset'));
    expect(inside.length).toBeGreaterThan(0);
    const enabled = screen
      .queryAllByRole('button')
      .filter((button) => button.closest('fieldset') && !button.matches(':disabled'));
    expect(enabled).toEqual([]);
  });

  it('is offered every change when it holds `invitation:design`', async () => {
    serveDesign(server);
    renderDesign(session, '/app/events/e1/design/sections/HERO', 'en', [
      ...VIEWER,
      'invitation:design',
    ]);
    expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.queryByText(READ_ONLY)).not.toBeInTheDocument();
  });
});
