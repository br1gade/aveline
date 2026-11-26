import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { billingReturnPath } from './billing-return';
import { ROUTE_PATHS } from '@/route-paths';

/**
 * The bank's parameters on its return may name its order number, which opens the payment's state
 * (docs/API.md §9), so they leave the address at once. The chosen language stays.
 */
export function useDropBankQuery(): void {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.pathname === ROUTE_PATHS.billingPaymentReturn) {
      const cleaned = billingReturnPath(
        new URL(`${location.pathname}${location.search}`, 'https://app.invalid'),
      );
      if (`${location.pathname}${location.search}` !== cleaned)
        void navigate(cleaned, { replace: true, preventScrollReset: true });
      return;
    }
    const params = new URLSearchParams(location.search);
    const language = params.get('lang');
    if ([...params.keys()].every((key) => key === 'lang')) return;
    void navigate(
      { search: language ? `?${new URLSearchParams({ lang: language })}` : '' },
      { replace: true, preventScrollReset: true },
    );
  }, [location.pathname, location.search, navigate]);
}
