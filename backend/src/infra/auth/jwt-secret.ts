import { allowsDevelopmentShortcuts } from '../../common/environment';

/**
 * The key access tokens are signed with.
 *
 * An empty value counts as unset, because `.env.example` leaves it empty.
 * Outside development and test, refusing to boot is the only safe answer: a
 * default secret in production means anyone can mint a staff token.
 */
export function jwtSecret(configured: string | undefined, nodeEnv: string | undefined): string {
  if (configured) return configured;
  if (!allowsDevelopmentShortcuts(nodeEnv)) throw new Error('JWT_SECRET must be set outside development and test');
  return 'development-only-secret-do-not-use-in-production';
}
