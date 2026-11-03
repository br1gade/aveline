import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { FieldValues, UseFormSubscribe } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router';

import { AskFirstDialog } from './ask-first-dialog';
import { useDialogOpener } from './use-dialog-opener';

interface LeaveGuardRegistry {
  mark: (formId: string, hasUnsavedChanges: boolean) => void;
}

const LeaveGuardContext = createContext<LeaveGuardRegistry | null>(null);

/**
 * A navigation's `state` that goes without asking: the session's end, after which nothing can be
 * saved and the page can't stay.
 */
export const LEAVE_UNASKED = { isLeaveUnasked: true } as const;

function isLeaveUnasked(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'isLeaveUnasked' in state;
}

/**
 * The forms of the page with unsaved changes. Kept outside React's state and read at the moment of
 * leaving: a save that goes on at once must already count, before any re-render could tell.
 */
function useUnsavedForms() {
  const unsaved = useRef(new Set<string>());
  const mark = useCallback((formId: string, hasUnsavedChanges: boolean) => {
    if (hasUnsavedChanges) unsaved.current.add(formId);
    else unsaved.current.delete(formId);
  }, []);
  const hasUnsaved = useCallback(() => unsaved.current.size > 0, []);
  return { hasUnsaved, mark };
}

/**
 * The app's one guard against leaving unsaved changes (design PD-119): React Router allows one
 * blocker at a time, and a page can hold several forms. A link or Back to another page asks first;
 * a search on the same page keeps its forms, so it doesn't, and nor does a navigation marked
 * `LEAVE_UNASKED`. A reload or closing the tab gets the browser's own question. Each form says
 * whether it has changes through `useLeaveGuard`.
 */
export function LeaveGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const { hasUnsaved, mark } = useUnsavedForms();
  const { remember, restoreFocus } = useDialogOpener();
  const shouldAsk: BlockerFunction = ({ currentLocation, nextLocation }) => {
    const isLeaving =
      hasUnsaved() &&
      currentLocation.pathname !== nextLocation.pathname &&
      !isLeaveUnasked(nextLocation.state);
    if (isLeaving && document.activeElement instanceof HTMLElement) {
      remember(document.activeElement);
    }
    return isLeaving;
  };
  const blocker = useBlocker(shouldAsk);
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (hasUnsaved()) event.preventDefault();
      },
      [hasUnsaved],
    ),
  );
  const registry = useMemo(() => ({ mark }), [mark]);
  return (
    <LeaveGuardContext.Provider value={registry}>
      {children}
      {blocker.state === 'blocked' ? (
        <AskFirstDialog
          onOpenChange={(isOpen) => {
            if (!isOpen) blocker.reset();
          }}
          onCloseAutoFocus={restoreFocus}
          title={t('leave.title')}
          body={t('leave.body')}
          confirmLabel={t('leave.confirm')}
          isBusy={false}
          problem={null}
          onConfirm={() => blocker.proceed()}
        />
      ) : null}
    </LeaveGuardContext.Provider>
  );
}

/**
 * What a form tells the guard. `subscribe`'s type names no `isSubmitting`, but it is honoured as
 * `useForm`'s own re-render subscribes to it; without it a save's start would not reach the
 * guard. The leave guard's test of a save that goes on at once fails if that stops.
 */
const WATCHED = { isDirty: true, isSubmitting: true };

/**
 * Marks the form's changes as unsaved while it differs from what was last saved. Not while it is
 * being saved, so the page a save goes to is never asked about. It listens to the form itself,
 * which says a save has begun before its first wait. Outside `LeaveGuard` it does nothing.
 */
export function useLeaveGuard<Values extends FieldValues>({
  subscribe,
}: {
  subscribe: UseFormSubscribe<Values>;
}): void {
  const registry = useContext(LeaveGuardContext);
  const formId = useId();
  useEffect(() => {
    if (!registry) return undefined;
    const unsubscribe = subscribe({
      formState: WATCHED,
      callback: ({ isDirty = false, isSubmitting = false }) => {
        registry.mark(formId, isDirty && !isSubmitting);
      },
    });
    return () => {
      unsubscribe();
      registry.mark(formId, false);
    };
  }, [registry, formId, subscribe]);
}
