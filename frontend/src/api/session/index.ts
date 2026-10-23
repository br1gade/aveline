// The session skeleton. Nothing signs in yet: these pieces are wired when the sign-in screens are
// built (docs/ARCHITECTURE.md §5).
export { createSessionChannel } from './channel';
export type { SessionChannel } from './channel';
export { createSessionRefresher, REFRESH_LOCK } from './refresh';
export type { RefreshDependencies } from './refresh';
export { createTokenStore } from './token-store';
export type { TokenPair, TokenStore } from './token-store';
