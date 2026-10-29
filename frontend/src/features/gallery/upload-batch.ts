import { isApiError } from '@/api/errors';

import { isCaptionRefusal, uploadConflict } from './refusals';
import { photoProblem, type PhotoProblem } from './rules';
import type { GalleryPhoto } from './types';

/**
 * Several photos, sent one after another (one per request, docs/API.md §11; design PD-63). A file
 * refused for itself (its type, its size, a 400, its caption's 400) is marked and the next one goes. Anything that
 * would refuse the next one too stops the batch, and the photos not sent are kept for "Send the
 * rest": a limit reached (409), a link that closed (404), too many requests (429), storage out
 * (503), a server failure or no connection. "Stop" stops after the photo being sent.
 */
export type FileOutcome =
  | { kind: 'shared'; photo: GalleryPhoto }
  | { kind: 'refused'; reason: PhotoProblem | 'refused' | 'caption' }
  | { kind: 'notSent' };

export type BatchStop =
  | { kind: 'limit' | 'full' | 'conflict' | 'closed' | 'rate-limited' | 'busy' | 'unreachable' }
  | { kind: 'failed'; requestId: string | undefined }
  | { kind: 'stopped' };

export interface BatchResult {
  /** One per file chosen, in their order. */
  outcomes: FileOutcome[];
  stop: BatchStop | null;
  /** The positions of the files not sent, for "Send the rest". */
  rest: number[];
}

export interface BatchOptions {
  /** Asked before each photo: whether the guest pressed Stop. */
  shouldStop: () => boolean;
  /** The position of the photo being sent, for "Sharing 2 of 5…". */
  onSending?: (index: number) => void;
}

const OWN_REFUSALS: Readonly<Record<number, FileOutcome>> = {
  400: { kind: 'refused', reason: 'refused' },
  413: { kind: 'refused', reason: 'size' },
  415: { kind: 'refused', reason: 'type' },
};

const STOPS: Readonly<Record<number, BatchStop>> = {
  0: { kind: 'unreachable' },
  404: { kind: 'closed' },
  429: { kind: 'rate-limited' },
  503: { kind: 'busy' },
};

const CONFLICT_STOPS = { count: 'limit', storage: 'full', other: 'conflict' } as const;

/** What a refusal means for this file, or for the batch. */
function classify(error: unknown): FileOutcome | BatchStop {
  if (!isApiError(error)) return { kind: 'failed', requestId: undefined };
  if (error.status === 400 && isCaptionRefusal(error))
    return { kind: 'refused', reason: 'caption' };
  const own = OWN_REFUSALS[error.status];
  if (own) return own;
  if (error.status === 409) return { kind: CONFLICT_STOPS[uploadConflict(error)] };
  return STOPS[error.status] ?? { kind: 'failed', requestId: error.requestId };
}

function isOutcome(value: FileOutcome | BatchStop): value is FileOutcome {
  return value.kind === 'refused';
}

async function sendOne(file: File, send: (file: File) => Promise<GalleryPhoto>) {
  const problem = photoProblem(file);
  if (problem) return { kind: 'refused', reason: problem } satisfies FileOutcome;
  try {
    return { kind: 'shared', photo: await send(file) } satisfies FileOutcome;
  } catch (error) {
    return classify(error);
  }
}

export async function sendBatch(
  files: readonly File[],
  send: (file: File) => Promise<GalleryPhoto>,
  { shouldStop, onSending }: BatchOptions,
): Promise<BatchResult> {
  const outcomes: FileOutcome[] = files.map(() => ({ kind: 'notSent' }));
  for (const [index, file] of files.entries()) {
    if (index > 0 && shouldStop()) return finish(outcomes, { kind: 'stopped' });
    onSending?.(index);
    const result = await sendOne(file, send);
    if (result.kind === 'shared' || isOutcome(result)) {
      outcomes[index] = result;
      continue;
    }
    return finish(outcomes, result);
  }
  return finish(outcomes, null);
}

function finish(outcomes: FileOutcome[], stop: BatchStop | null): BatchResult {
  const rest = outcomes.flatMap((outcome, index) => (outcome.kind === 'notSent' ? [index] : []));
  return { outcomes, stop, rest };
}

/**
 * What stays chosen after a batch: the photos not sent, and one refused only for its caption,
 * which a corrected caption lets through. A photo shared, or refused for itself, is not chosen
 * again, so pressing Share once more never sends a photo twice.
 */
export function stillChosen(files: readonly File[], result: BatchResult): File[] {
  return files.filter((_, index) => {
    const outcome = result.outcomes[index];
    return (
      outcome?.kind === 'notSent' || (outcome?.kind === 'refused' && outcome.reason === 'caption')
    );
  });
}
