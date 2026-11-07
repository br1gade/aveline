import { isApiError } from './errors';
import { problemFrom, type Problem } from './problems';

/**
 * A part of a page that loads on its own: ready, refused to this role (a 403), or failed, which
 * leaves the rest of the page standing and says why.
 */
export type Loaded<T> =
  { kind: 'ready'; value: T } | { kind: 'refused' } | { kind: 'failed'; problem: Problem };

/** Any error that is not the API's own is a bug, and is thrown on. */
export async function loaded<T>(load: Promise<T>): Promise<Loaded<T>> {
  try {
    return { kind: 'ready', value: await load };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return error.status === 403
      ? { kind: 'refused' }
      : { kind: 'failed', problem: problemFrom(error) };
  }
}
