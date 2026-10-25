import { isApiError } from './errors';

/**
 * What went wrong with a submission, in the client's terms. The backend's messages are English
 * and, for validation, not prefixed with their field (FR-20), so the page words each case itself
 * and the form checks the same limits first.
 */
export type Problem =
  | { code: 'rate-limited' }
  | { code: 'unreachable' }
  | { code: 'server'; requestId: string | undefined }
  | { code: 'refused'; status: number };

export function problemFrom(error: unknown): Problem {
  if (!isApiError(error)) {
    return { code: 'server', requestId: undefined };
  }
  if (error.status === 0) {
    return { code: 'unreachable' };
  }
  if (error.status === 429) {
    return { code: 'rate-limited' };
  }
  if (error.status >= 500) {
    return { code: 'server', requestId: error.requestId };
  }
  return { code: 'refused', status: error.status };
}
