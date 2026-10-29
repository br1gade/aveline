import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';

import { answer, API, ORIGIN, refusal, serveDesign, SLUG } from './test-data';
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

const LOOK = '/app/events/e1/design/look';
const QUESTIONS = '/app/events/e1/design/questions';

describe('the template and look', () => {
  it('offers only the template’s fonts and palettes, and sends only what changed', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/theme`);
    const user = renderDesign(session, LOOK);

    const body = await screen.findByLabelText('Font for text');
    expect(
      within(body)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Noto Serif Armenian', 'Cormorant Garamond', 'Inter']);
    expect(screen.getByRole('radio', { name: /sage/ })).toBeChecked();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'ivory-gold',
      'sage',
    ]);
    await user.click(screen.getByRole('radio', { name: /ivory-gold/ }));
    await user.click(screen.getByRole('button', { name: 'Save the look' }));

    await screen.findByText('Look saved.');
    expect(sent).toEqual([{ palette: 'ivory-gold' }]);
  });

  it('marks every field a refusal names at once', async () => {
    serveDesign(server);
    answer(
      server,
      'patch',
      `/invitations/${SLUG}/theme`,
      refusal(400, [
        'bodyFont: "Inter" is not one of this template\'s fonts (Noto Serif Armenian)',
        'palette: "ivory-gold" is not one of this template\'s palettes (sage)',
      ]),
    );
    const user = renderDesign(session, LOOK);

    await user.selectOptions(await screen.findByLabelText('Font for text'), 'Inter');
    await user.click(screen.getByRole('radio', { name: /ivory-gold/ }));
    await user.click(screen.getByRole('button', { name: 'Save the look' }));

    await waitFor(() =>
      expect(screen.getAllByText('This wasn’t accepted. Check it.')).toHaveLength(2),
    );
    expect(screen.getByLabelText('Font for text')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says what another template changes before switching to it', async () => {
    serveDesign(server);
    const sent = answer(server, 'post', `/invitations/${SLUG}/template`);
    const user = renderDesign(session, LOOK);

    const minimal = (await screen.findByRole('heading', { name: 'Minimal' })).closest('li');
    expect(
      within(minimal as HTMLElement).getByText('Can’t show: Invitation text'),
    ).toBeInTheDocument();
    expect(
      within(minimal as HTMLElement).getByRole('link', { name: 'Preview with my invitation' }),
    ).toHaveAttribute('href', '/app/events/e1/design/preview?template=minimal');
    await user.click(screen.getByRole('button', { name: 'Use this template: Minimal' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Use Minimal?' });
    expect(
      within(dialog).getByText('The look goes back to this template’s own: Inter, paper.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('These sections are hidden, keeping their words: Invitation text.'),
    ).toBeInTheDocument();
    // The cover's layout, split, is one Minimal offers too: nothing resets.
    expect(within(dialog).queryByText(/default layout/)).toBeNull();
    expect(within(dialog).getByText(/It can also show Contact/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Use Minimal' }));

    await screen.findByText('The invitation now uses Minimal.');
    expect(sent).toEqual([{ templateKey: 'minimal' }]);
  });

  it('leaves the look standing when the templates cannot be read', async () => {
    serveDesign(server);
    server.use(http.get(`${API}/events/e1/design-templates`, refusal(403)));
    renderDesign(session, LOOK);
    expect(await screen.findByLabelText('Font for text')).toBeInTheDocument();
    expect(screen.getByText('Your role can’t see the templates.')).toBeInTheDocument();
  });
});

describe('the questions', () => {
  it('switches a built-in question off and gives the drink fixed choices, with keys', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/rsvp-fields`);
    const user = renderDesign(session, QUESTIONS);

    const song = await screen.findByRole('group', { name: 'A song request' });
    await user.click(within(song).getByRole('checkbox', { name: 'Ask this' }));
    const drink = screen.getByRole('group', { name: 'Drink' });
    await user.click(within(drink).getByRole('radio', { name: 'Guests choose from a list' }));
    await user.click(within(drink).getByRole('button', { name: 'Add a choice' }));
    await user.type(within(drink).getByLabelText('Choice 1, English'), 'Red wine');
    await user.type(within(drink).getByLabelText('Choice 1, Հայերեն'), 'Կարմիր գինի');
    await user.click(screen.getByRole('button', { name: 'Save these questions' }));

    await screen.findByText('Questions saved.');
    expect(sent).toEqual([
      {
        drinkPreference: {
          isEnabled: true,
          options: [{ key: 'red-wine', label: { hy: 'Կարմիր գինի', en: 'Red wine' } }],
        },
        songRequest: { isEnabled: false },
      },
    ]);
  });

  it('refuses a choice with no label before sending', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/rsvp-fields`);
    const user = renderDesign(session, QUESTIONS);

    const dietary = await screen.findByRole('group', { name: 'Dietary needs' });
    await user.click(within(dietary).getByRole('radio', { name: 'Guests choose from a list' }));
    await user.click(within(dietary).getByRole('button', { name: 'Add a choice' }));
    await user.click(screen.getByRole('button', { name: 'Save these questions' }));

    expect(
      await screen.findByText('Give this choice in at least one language.'),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('lists the host’s questions in order, and offers no removal once answered', async () => {
    serveDesign(server);
    renderDesign(session, QUESTIONS);

    const own = await screen.findByRole('region', { name: 'Your own questions' });
    const headings = within(own).getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Ինչպե՞ս եք հասնելու',
      'Anything we should know?',
    ]);
    const answered = headings[0]?.closest('li') as HTMLElement;
    expect(within(answered).getByText(/Answered by 12 guests/)).toBeInTheDocument();
    expect(within(answered).queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(within(answered).getByText(/Make it optional instead/)).toBeInTheDocument();
  });

  it('removes an unanswered question after asking', async () => {
    serveDesign(server);
    const sent = answer(server, 'delete', `/invitations/${SLUG}/questions/q2`);
    const user = renderDesign(session, QUESTIONS);

    await user.click(
      await screen.findByRole('button', { name: 'Remove: Anything we should know?' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove it' }));

    await screen.findByText('“Anything we should know?” removed.');
    expect(sent).toEqual(['deleted']);
  });

  it('moves a question with the order read, and reloads when it changed meanwhile', async () => {
    const reads = serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/question-order`, refusal(409));
    const user = renderDesign(session, QUESTIONS);

    await user.click(
      await screen.findByRole('button', { name: 'Move up: Anything we should know?' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The questions changed since this page was loaded',
    );
    expect(sent).toEqual([{ questionIds: ['q2', 'q1'], expectedOrder: ['q1', 'q2'] }]);
    await waitFor(() => expect(reads.design).toBe(2));
  });

  it('refuses a choice question with a language half filled, then adds it', async () => {
    serveDesign(server);
    const sent = answer(server, 'post', `/invitations/${SLUG}/questions`);
    const user = renderDesign(session, '/app/events/e1/design/questions/new');

    await user.selectOptions(await screen.findByLabelText('Kind of question'), 'SINGLE_CHOICE');
    await user.type(screen.getByLabelText('English'), 'Which meal?');
    await user.type(screen.getByLabelText('Choice 1, English'), 'Fish');
    await user.type(screen.getByLabelText('Choice 2, English'), 'Meat');
    await user.type(screen.getByLabelText('Choice 1, Հայերեն'), 'Ձուկ');
    await user.click(screen.getByRole('button', { name: 'Add the question' }));

    expect(await screen.findByText('Give every choice in Հայերեն, or none.')).toBeInTheDocument();
    expect(sent).toEqual([]);

    await user.type(screen.getByLabelText('Choice 2, Հայերեն'), 'Միս');
    await user.click(screen.getByRole('button', { name: 'Add the question' }));
    await screen.findByRole('heading', { level: 1, name: 'Questions for guests' });
    expect(sent).toEqual([
      {
        type: 'SINGLE_CHOICE',
        required: false,
        prompt: { en: 'Which meal?' },
        options: { hy: ['Ձուկ', 'Միս'], en: ['Fish', 'Meat'] },
      },
    ]);
  });

  it('locks an answered question’s kind and keeps its choices, sending only what changed', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', `/invitations/${SLUG}/questions/q1`);
    const user = renderDesign(session, '/app/events/e1/design/questions/q1');

    expect(await screen.findByLabelText('Kind of question')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Remove choice/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add a choice' }));
    await user.type(screen.getByLabelText('Choice 3, English'), 'On foot');
    await user.type(screen.getByLabelText('Choice 3, Հայերեն'), 'Ոտքով');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('heading', { level: 1, name: 'Questions for guests' });
    expect(sent).toEqual([
      {
        options: {
          hy: ['Մեքենայով', 'Տրանսֆերով', 'Ոտքով'],
          en: ['Own car', 'Shuttle', 'On foot'],
        },
      },
    ]);
  });

  it('says so when the question is no longer on the invitation', async () => {
    serveDesign(server);
    renderDesign(session, '/app/events/e1/design/questions/gone');
    expect(
      await screen.findByText('This question is no longer on the invitation.'),
    ).toBeInTheDocument();
  });
});
