import { useCallback, useEffect, useRef, useState } from 'react';
import { useMatches, useRevalidator } from 'react-router';

/** What a page's panels need from it after an action. */
export interface PageActions {
  /** After an action went through: reload the page, then say what happened, with the focus. */
  done: (message: string) => Promise<void>;
  /** The invitation changed underneath: reload the page behind the message. */
  reload: () => void;
  /** The same, for a press that must wait until the page has been read again. */
  reloadAndWait: () => Promise<void>;
  /** Radix's `onCloseAutoFocus` for a dialog whose action went through: to the status line. */
  focusStatus: (closing: Event) => void;
}

/** An action that went through, waiting for the reloaded page to reach the screen. */
interface Done {
  message: string;
  /** The page's data as it was when the action was sent. */
  before: unknown;
}

/**
 * The page's status line. It speaks, and takes the focus, in the render that shows the reloaded
 * page, which React Router applies as a transition: the line never says "published" beside the
 * draft's panel, and the button pressed is often gone by then.
 */
export function usePageStatus(data: unknown) {
  const { revalidate, state } = useRevalidator();
  const [done, setDone] = useState<Done | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const status = done !== null && data !== done.before ? done.message : '';
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  const announce = useCallback(
    async (message: string) => {
      await revalidate();
      setDone({ message, before: data });
    },
    [revalidate, data],
  );
  const reload = useCallback(() => void revalidate(), [revalidate]);
  const reloadAndWait = useReloadAndWait(revalidate, state);
  const focusStatus = useCallback((closing: Event) => {
    closing.preventDefault();
    statusRef.current?.focus();
  }, []);
  const page: PageActions = { done: announce, reload, reloadAndWait, focusStatus };
  return { page, status, statusRef };
}

interface ReloadCommit {
  before: ReturnType<typeof useMatches>;
  resolve: () => void;
}

/** Router resolves revalidate before React commits; retries need the committed route snapshot. */
function useReloadAndWait(revalidate: PageActions['reloadAndWait'], state: 'idle' | 'loading') {
  const matches = useMatches();
  const pending = useRef(new Set<ReloadCommit>());
  const isMounted = useRef(true);
  useEffect(() => {
    if (state !== 'idle') return;
    for (const waiting of pending.current) {
      if (waiting.before !== matches) {
        pending.current.delete(waiting);
        waiting.resolve();
      }
    }
  }, [matches, state]);
  useEffect(() => {
    isMounted.current = true;
    const waiting = pending.current;
    return () => {
      isMounted.current = false;
      for (const request of waiting) request.resolve();
      waiting.clear();
    };
  }, []);
  return useCallback(async () => {
    if (!isMounted.current) return;
    const waiting: ReloadCommit = { before: matches, resolve: () => undefined };
    const committed = new Promise<void>((resolve) => {
      waiting.resolve = resolve;
    });
    pending.current.add(waiting);
    try {
      await revalidate();
      await committed;
    } finally {
      pending.current.delete(waiting);
    }
  }, [matches, revalidate]);
}
