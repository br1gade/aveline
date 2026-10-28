import { isApiError } from './errors';

/**
 * A read the backend refused with 409 because what it read changed while it read it, such as the
 * guest page's "Invitation changed while loading; please retry" (docs/API.md §6). The server has
 * already tried three times; one more attempt here usually lands. Nothing else is retried.
 */
export async function retryOnConflict<T>(load: () => Promise<T>, attempts = 2): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      if (!isApiError(error) || error.status !== 409 || attempt >= attempts) throw error;
    }
  }
}
