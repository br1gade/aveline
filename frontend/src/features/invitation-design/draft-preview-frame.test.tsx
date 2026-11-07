import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import type { Invitation } from '@/features/invitation-renderer';
import { createI18n } from '@/lib/i18n';

import { DraftPreviewFrame } from './components/draft-preview-frame';
import { draftMessage, READY_MESSAGE } from './draft-message';
import { ORIGIN, previewWire } from './test-data';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

beforeEach(() => {
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => vi.restoreAllMocks());

/** The section page that frames it: a window that only receives. */
function framedBy() {
  const page = { postMessage: vi.fn() };
  vi.spyOn(window, 'parent', 'get').mockReturnValue(page as unknown as Window);
  return page;
}

function renderFrame() {
  const Stub = createRoutesStub([
    { path: '/', Component: () => <DraftPreviewFrame eventId="e1" /> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub />
    </I18nextProvider>,
  );
}

function receive(data: unknown, source: unknown, origin = window.location.origin) {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('the draft preview’s frame (PD-153)', () => {
  const invitation = previewWire('en') as Invitation;

  it('says it is ready to the page that framed it, and draws the page it is sent', async () => {
    const page = framedBy();
    renderFrame();
    expect(screen.getByText('Preparing the preview…')).toBeInTheDocument();
    expect(page.postMessage).toHaveBeenCalledWith(READY_MESSAGE, window.location.origin);
    receive(draftMessage(invitation), page);
    expect(await screen.findByText('Anna & Davit')).toBeInTheDocument();
  });

  it('ignores a page sent from another origin, or another window', () => {
    const page = framedBy();
    renderFrame();
    receive(draftMessage(invitation), page, 'https://evil.example');
    receive(draftMessage(invitation), window);
    expect(screen.getByText('Preparing the preview…')).toBeInTheDocument();
  });

  it('says what it is for when opened on its own', () => {
    renderFrame();
    expect(
      screen.getByText(
        'This page shows a section’s unsaved changes inside the section’s own page.',
      ),
    ).toBeInTheDocument();
  });
});
