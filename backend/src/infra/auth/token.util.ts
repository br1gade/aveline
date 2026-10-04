import { createHash, randomBytes } from 'node:crypto';

/**
 * Refresh tokens are bearer credentials: whoever holds one can mint access
 * tokens. So they are long and random, and only their hash is ever stored —
 * a database leak must not hand over live sessions.
 */
export function newRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  // SHA-256 rather than bcrypt: the input is already 256 bits of entropy, so
  // there is nothing to brute-force and a slow hash would only cost latency
  // on every refresh.
  return createHash('sha256').update(token).digest('hex');
}

export function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}
