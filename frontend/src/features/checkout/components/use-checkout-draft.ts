import { useEffect, useMemo, useRef } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import { checkoutDraftStore } from '../draft-store';
import type { CheckoutValues } from '../types';
import type { useShowSelections } from './show-selections';

interface DraftSetup {
  slug: string;
  /** The event, layout and basket, as the seat picks are scoped. */
  scope: string;
  revision: number;
  form: UseFormReturn<CheckoutValues>;
  selections: ReturnType<typeof useShowSelections>;
}

/**
 * What the buyer typed and chose, kept across a reload in this tab (design PD-152, audit F-21).
 * Brought back once the page runs, so the server's page and the first render agree; a draft for
 * another basket or layout is dropped, and one typed before the hosts changed how guests answer
 * keeps everything but the places, as `useRevisionReset` does. Returns `clear`, for a placed order.
 */
export function useCheckoutDraft({ slug, scope, revision, form, selections }: DraftSetup) {
  const store = useMemo(() => checkoutDraftStore(slug), [slug]);
  const isRestored = useRef(false);
  const { picks, restore } = selections;

  useEffect(() => {
    if (isRestored.current) return;
    isRestored.current = true;
    const stored = store.read();
    if (!stored) return;
    if (stored.scope !== scope) {
      store.clear();
      return;
    }
    const isSameRevision = stored.revision === revision;
    const people = stored.values.people.map((person) =>
      isSameRevision ? person : { ...person, venues: {} },
    );
    form.reset({ ...stored.values, people }, { keepDefaultValues: true });
    restore(stored.picks);
  }, [store, scope, revision, form, restore]);

  useEffect(() => {
    if (!isRestored.current) return undefined;
    const save = () => store.write({ scope, revision, values: form.getValues(), picks });
    save();
    const { unsubscribe } = form.watch(save);
    return unsubscribe;
  }, [store, scope, revision, form, picks]);

  return { clear: store.clear };
}
