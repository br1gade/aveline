import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';

/** What the invitation page's panels need from it after an action. */
export interface PageActions {
  /** After an action went through: reload the page, then say what happened, with the focus. */
  done: (message: string) => Promise<void>;
  /** The invitation changed underneath: reload the page behind the message. */
  reload: () => void;
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
  const { revalidate } = useRevalidator();
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
  const focusStatus = useCallback((closing: Event) => {
    closing.preventDefault();
    statusRef.current?.focus();
  }, []);
  const page: PageActions = { done: announce, reload, focusStatus };
  return { page, status, statusRef };
}
