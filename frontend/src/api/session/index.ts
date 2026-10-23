// The browser session (docs/ARCHITECTURE.md §5): the store, the refresher and the channel, wired to
// the API by browser-session.ts.
export { logIn, type Credentials, type SessionTokens } from './auth-calls';
export { browserSession, createBrowserSession } from './browser-session';
export type { BrowserSession, BrowserSessionDependencies } from './browser-session';
export { createSessionChannel } from './channel';
export type { SessionChannel } from './channel';
export { createSessionRefresher, REFRESH_LOCK } from './refresh';
export type { RefreshDependencies } from './refresh';
export { createTokenStore } from './token-store';
export type { TokenPair, TokenStore } from './token-store';
