import { randomBytes } from 'node:crypto';

/**
 * A capability token made at run time, for tests: no guest, ticket or brief token is ever
 * committed in a fixture (frontend CLAUDE.md §10). The same 32 bytes the backend draws.
 */
export function plantedToken(): string {
  return randomBytes(32).toString('hex');
}
