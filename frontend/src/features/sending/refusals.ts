import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';

export type LifecycleAction = 'publish' | 'close' | 'reopen' | 'send';

/**
 * A refused action: what to say, the backend's own sentences when they explain it, and whether the
 * page is now out of date. The invitation's refusals that name no field are English sentences
 * without a code (FR-28, FR-32), so the status and the action decide the words.
 */
export interface Refusal {
  problem: Problem;
  /** A 400's sentences, shown in English under our words. */
  messages: readonly string[];
  /** The invitation changed underneath: reload the page behind the message. */
  isStale: boolean;
}

export function refusalOf(error: unknown): Refusal {
  const problem = problemFrom(error);
  const status = problem.code === 'refused' ? problem.status : 0;
  const messages = isApiError(error) && status === 400 ? error.messages : [];
  return { problem, messages, isStale: status === 400 || status === 404 || status === 409 };
}

type ProblemKey = 'forbidden' | 'state' | 'missing' | 'conflict' | 'sendRefused' | 'other';

/**
 * Publishing, closing, reopening and sending all need `invitation:publish` (there is no
 * permissions endpoint, FR-6). A 400 on publishing that is not the readiness check, or on closing
 * or reopening, is a state that changed meanwhile ("already published", an archived event). On
 * sending it is a draft or closed invitation, no guests yet, or a guest not on the event.
 */
const WORDS: Readonly<Record<LifecycleAction, Partial<Record<number, ProblemKey>>>> = {
  publish: { 400: 'state', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
  close: { 400: 'state', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
  reopen: { 400: 'state', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
  send: { 400: 'sendRefused', 403: 'forbidden', 404: 'missing', 409: 'conflict' },
};

export function useRefusedText(action: LifecycleAction): (status: number) => string {
  const { t } = useTranslation('sending');
  return (status) => t(`problems.${WORDS[action][status] ?? 'other'}`);
}
