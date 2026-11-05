import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import { photo, picked } from './test-data';
import type { GalleryPhoto } from './types';
import { sendBatch, stillChosen } from './upload-batch';

const refused = (status: number, message = 'No', requestId?: string) =>
  new ApiError({ status, messages: [message], requestId });

const files = [picked('a.jpg'), picked('b.jpg'), picked('c.jpg')];

function sender(...answers: Array<GalleryPhoto | ApiError>) {
  const send = vi.fn<(file: File) => Promise<GalleryPhoto>>();
  for (const answer of answers) {
    if (answer instanceof ApiError) send.mockRejectedValueOnce(answer);
    else send.mockResolvedValueOnce(answer);
  }
  return send;
}

const keepGoing = { shouldStop: () => false };

describe('a photo made smaller before it goes (PD-150)', () => {
  const big = picked('big.jpg', 'image/jpeg', 14 * 1024 * 1024);

  it('sends the smaller photo, and checks its size, not the one chosen', async () => {
    const small = picked('big.jpg', 'image/jpeg', 3_000_000);
    const send = sender(photo({ id: 'p1' }));
    const result = await sendBatch([big], send, {
      ...keepGoing,
      shrink: () => Promise.resolve(small),
    });
    expect(send).toHaveBeenCalledWith(small);
    expect(result.outcomes[0]?.kind).toBe('shared');
  });

  it('refuses one still over 10 MiB without sending it', async () => {
    const send = sender();
    const result = await sendBatch([big], send, {
      ...keepGoing,
      shrink: (file) => Promise.resolve(file),
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toEqual({ kind: 'refused', reason: 'size' });
  });
});

describe('sending several photos, one after another', () => {
  it('sends each in turn and says what became of it', async () => {
    const send = sender(photo({ id: 'p1' }), photo({ id: 'p2' }), photo({ id: 'p3' }));
    const progress: number[] = [];
    const result = await sendBatch(files, send, {
      ...keepGoing,
      onSending: (i) => progress.push(i),
    });
    expect(result.outcomes.map((outcome) => outcome.kind)).toEqual(['shared', 'shared', 'shared']);
    expect(result.stop).toBeNull();
    expect(result.rest).toEqual([]);
    expect(progress).toEqual([0, 1, 2]);
  });

  it('refuses a file the checks refuse without sending it, and goes on', async () => {
    const send = sender(photo({ id: 'p1' }), photo({ id: 'p3' }));
    const chosen = [picked('a.jpg'), picked('b.heic', 'image/heic'), picked('c.jpg')];
    const result = await sendBatch(chosen, send, keepGoing);
    expect(result.outcomes).toEqual([
      { kind: 'shared', photo: photo({ id: 'p1' }) },
      { kind: 'refused', reason: 'type' },
      { kind: 'shared', photo: photo({ id: 'p3' }) },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    [413, 'size'],
    [415, 'type'],
    [400, 'refused'],
  ])('marks a %i as that file’s own refusal, and sends the next', async (status, reason) => {
    const send = sender(refused(status), photo({ id: 'p2' }), photo({ id: 'p3' }));
    const result = await sendBatch(files, send, keepGoing);
    expect(result.outcomes[0]).toEqual({ kind: 'refused', reason });
    expect(result.outcomes.slice(1).map((outcome) => outcome.kind)).toEqual(['shared', 'shared']);
    expect(result.stop).toBeNull();
  });

  it.each([
    [refused(409, 'uploads: photo count limit reached; remove an unused upload first'), 'limit'],
    [
      refused(409, 'uploads: private storage limit reached; removed files must be reclaimed'),
      'full',
    ],
    [refused(409, 'Something else'), 'conflict'],
    [refused(404), 'closed'],
    [refused(429), 'rate-limited'],
    [refused(503), 'busy'],
    [refused(0), 'unreachable'],
  ])('stops the batch at %o, keeping the rest', async (error, kind) => {
    const send = sender(photo({ id: 'p1' }), error);
    const result = await sendBatch(files, send, keepGoing);
    expect(result.stop).toEqual({ kind });
    expect(result.outcomes.map((outcome) => outcome.kind)).toEqual([
      'shared',
      'notSent',
      'notSent',
    ]);
    expect(result.rest).toEqual([1, 2]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps a server failure’s reference', async () => {
    const send = sender(refused(500, 'Boom', 'req-7'));
    const result = await sendBatch(files, send, keepGoing);
    expect(result.stop).toEqual({ kind: 'failed', requestId: 'req-7' });
    expect(result.rest).toEqual([0, 1, 2]);
  });

  it('stops after the photo being sent when asked to', async () => {
    let isStopped = false;
    const send = vi.fn(() => {
      isStopped = true;
      return Promise.resolve(photo({ id: 'p1' }));
    });
    const result = await sendBatch(files, send, { shouldStop: () => isStopped });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.stop).toEqual({ kind: 'stopped' });
    expect(result.rest).toEqual([1, 2]);
  });

  it('marks a 400 about the caption as the caption’s, and sends the next', async () => {
    const caption = new ApiError({
      status: 400,
      messages: ['caption must be shorter than or equal to 500 characters'],
      feedback: {
        code: 'VALIDATION_FAILED',
        action: 'EDIT',
        userMessage: undefined,
        details: [{ field: 'caption', code: 'TOO_LONG', userMessage: 'Too long' }],
      },
    });
    const send = sender(caption);
    const result = await sendBatch([picked('a.jpg')], send, keepGoing);
    expect(result.outcomes).toEqual([{ kind: 'refused', reason: 'caption' }]);
  });
});

describe('what stays chosen after a batch', () => {
  it('keeps the photos not sent and one whose caption was refused, and nothing shared', () => {
    const chosen = [
      picked('a.jpg'),
      picked('b.jpg'),
      picked('c.heic', 'image/heic'),
      picked('d.jpg'),
    ];
    const kept = stillChosen(chosen, {
      outcomes: [
        { kind: 'shared', photo: photo({ id: 'p1' }) },
        { kind: 'refused', reason: 'caption' },
        { kind: 'refused', reason: 'type' },
        { kind: 'notSent' },
      ],
      stop: { kind: 'rate-limited' },
      rest: [3],
    });
    expect(kept.map((file) => file.name)).toEqual(['b.jpg', 'd.jpg']);
  });
});
