import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { SavedReply } from './components/saved-reply';
import { drawnAgreements, type AcknowledgementRecord, type Statement } from './signatures';
import type { ReplyRecord } from './types';

const statement: Statement = {
  questionId: 'q1',
  statementVersionId: 'v2',
  prompt: 'I agree',
  required: true,
  locale: 'en',
};

function record(overrides: Partial<AcknowledgementRecord>): AcknowledgementRecord {
  return {
    id: 'ack-1',
    questionId: 'q1',
    statementVersionId: 'v2',
    subjectGuestId: 'g1',
    method: 'DRAWN',
    createdAt: '2027-01-01T10:00:00Z',
    mediaId: 'm1',
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('the drawn signatures behind a saved reply', () => {
  it('finds a drawn agreement, and only a drawn one', () => {
    expect(
      drawnAgreements(
        [statement],
        [record({}), record({ id: 'ack-2', method: 'TYPED', mediaId: null })],
      ),
    ).toEqual([{ acknowledgementId: 'ack-1', guestIds: ['g1'] }]);
  });

  it('shows a drawing made for a household once, with all of them', () => {
    expect(
      drawnAgreements([statement], [record({}), record({ id: 'ack-2', subjectGuestId: 'g2' })]),
    ).toEqual([{ acknowledgementId: 'ack-1', guestIds: ['g1', 'g2'] }]);
  });

  it('leaves out a drawing for a wording no longer current', () => {
    expect(drawnAgreements([statement], [record({ statementVersionId: 'v1' })])).toEqual([]);
  });

  it('leaves out one whose picture is gone', () => {
    expect(drawnAgreements([statement], [record({ mediaId: null })])).toEqual([]);
  });

  it('keeps two drawings apart', () => {
    expect(
      drawnAgreements([statement], [record({}), record({ id: 'ack-2', mediaId: 'm2' })]),
    ).toHaveLength(2);
  });
});

describe('a drawn signature on the saved reply', () => {
  const saved = {
    rsvp: { status: 'ATTENDING', respondedAt: '2027-01-01T10:00:00Z' },
    guest: { id: 'g1', firstName: 'Ani', lastName: null },
    household: { members: [] },
    party: [],
    attendance: { mode: 'EVENT_WIDE', venues: [] },
  } as unknown as ReplyRecord;

  function show(load: (id: string, signal: AbortSignal) => Promise<Blob>) {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <SavedReply
          record={saved}
          venues={[]}
          agreed={['Ani']}
          drawings={[{ acknowledgementId: 'ack-1', names: 'Ani' }]}
          loadDrawing={load}
          zone={{ timeZone: 'Asia/Yerevan', locale: 'en' }}
        />
      </I18nextProvider>,
    );
  }

  it('reads nothing until asked, then shows it from memory', async () => {
    const load = vi.fn(() => Promise.resolve(new Blob(['x'], { type: 'image/png' })));
    show(load);
    expect(load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Show the signature for Ani' }));
    const picture = await screen.findByRole('img', { name: 'The signature drawn for Ani' });
    expect(picture).toHaveAttribute('src', 'blob:x');
    expect(load).toHaveBeenCalledWith('ack-1', expect.any(AbortSignal));
    await userEvent.click(screen.getByRole('button', { name: 'Hide the signature for Ani' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says when it can’t be shown, and reads again on request', async () => {
    const load = vi.fn(() => Promise.reject(new Error('gone')));
    show(load);
    await userEvent.click(screen.getByRole('button', { name: 'Show the signature for Ani' }));
    expect(await screen.findByText('The signature couldn’t be shown.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
