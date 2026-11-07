import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * False in the server render and during hydration, true once React runs in the browser. A form
 * that submits from JavaScript disables its submit button until then: before hydration the browser
 * would submit the form itself, putting what was typed, a password included, into the address.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
