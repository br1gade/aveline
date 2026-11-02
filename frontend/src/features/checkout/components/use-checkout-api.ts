import { useMemo } from 'react';

import { createPublicApi } from '@/api/client';
import { readPublicEnv } from '@/config/env';

/** The public API in the browser, asking for refusals in the page's language. */
export function useCheckoutApi(locale: string) {
  return useMemo(
    () => createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => locale }),
    [locale],
  );
}
