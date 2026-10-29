import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';

import {
  answer,
  designWire,
  EVENT,
  libraryWire,
  ORIGIN,
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
