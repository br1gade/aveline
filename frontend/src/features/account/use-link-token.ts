import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * The `?token=` an emailed link carries (a reset, an email check, an invitation). It is read once,
 * kept in memory, and taken out of the address bar straight after hydration, so it does not stay
 * in the history, a bookmark or a screenshot (frontend CLAUDE.md §4). The server render reads the
 * same value, so the two agree.
 */
export function useLinkToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.search).get('token'));

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('token')) return;
    params.delete('token');
    const search = params.toString();
    void navigate(
      { search: search ? `?${search}` : '' },
      { replace: true, preventScrollReset: true },
    );
  }, [location.search, navigate]);

  return token;
}
