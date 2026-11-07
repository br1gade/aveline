/**
 * Signing out in one tab signs out every tab (setup proposal §5.5). A thin wrapper over
 * BroadcastChannel that does nothing where it does not exist, including the server.
 */
const CHANNEL = 'aveline-session';

export interface SessionChannel {
  announceLogout(): void;
  onLogout(listener: () => void): () => void;
}

export function createSessionChannel(): SessionChannel {
  const channel =
    typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL);
  return {
    announceLogout: () => channel?.postMessage('logout'),
    onLogout(listener) {
      const handle = (event: MessageEvent) => {
        if (event.data === 'logout') {
          listener();
        }
      };
      channel?.addEventListener('message', handle);
      return () => channel?.removeEventListener('message', handle);
    },
  };
}
