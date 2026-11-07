import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import type { DeliveryGroup } from '@/features/sending';

import { filterFromQuery, withFilter, type GuestFilter } from '../filter';
import type { Answer } from '../types';

/** Long enough that a typed name reaches the address once, not a letter at a time. */
const SEARCH_DELAY_MS = 300;

/** Written in place, never as a new history entry, and without jumping to the top. */
const QUIETLY = { replace: true, preventScrollReset: true } as const;

/**
 * The search and the filters, kept in the address (`?q=`, `?answer=`, `?invite=`) so a reload or a
 * shared link keeps them. The search box holds its own text, so typing never waits for the router; the
 * address catches up when typing stops. A change of address this hook did not write (Back, a link)
 * replaces what is typed. The route skips reloading for a change of query alone
 * (`revalidateUnlessQueryOnly`).
 */
export function useGuestFilter() {
  const [params, setParams] = useSearchParams();
  const inAddress = filterFromQuery(params);
  const addressQuery = inAddress.query;
  const [query, setQuery] = useState(addressQuery);
  // The address's search as last seen, and as last written here, to tell the two kinds apart.
  const [seen, setSeen] = useState(addressQuery);
  const [written, setWritten] = useState(addressQuery);
  if (addressQuery !== seen) {
    setSeen(addressQuery);
    if (addressQuery !== written) setQuery(addressQuery);
  }

  const write = (next: GuestFilter) => {
    setWritten(next.query.trim());
    setParams((current) => withFilter(current, next), QUIETLY);
  };

  useEffect(() => {
    if (query.trim() === addressQuery.trim()) return undefined;
    const timer = setTimeout(() => {
      setWritten(query.trim());
      setParams((current) => withFilter(current, { ...filterFromQuery(current), query }), QUIETLY);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, addressQuery, setParams]);

  const setAnswer = (answer: Answer | null) => write({ ...inAddress, query, answer });
  const setInvite = (invite: DeliveryGroup | null) => write({ ...inAddress, query, invite });
  const clear = () => {
    setQuery('');
    write({ query: '', answer: null, invite: null });
  };

  const filter: GuestFilter = { query, answer: inAddress.answer, invite: inAddress.invite };
  return { filter, setQuery, setAnswer, setInvite, clear };
}
