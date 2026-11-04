import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * The bank's parameters on its return may name its order number, which opens the payment's state
 * (docs/API.md §9), so they leave the address at once. The chosen language stays.
 */
export function useDropBankQuery(): void {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const language = params.get('lang');
    if ([...params.keys()].every((key) => key === 'lang')) return;
    void navigate(
      { search: language ? `?${new URLSearchParams({ lang: language })}` : '' },
      { replace: true, preventScrollReset: true },
    );
  }, [location.search, navigate]);
}
