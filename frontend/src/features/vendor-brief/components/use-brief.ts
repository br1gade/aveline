import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createPublicApi } from '@/api/client';
import { readPublicEnv } from '@/config/env';
import { useIsHydrated } from '@/ui';

import { fetchBrief } from '../api';
import { briefFailureOf, type BriefFailure } from '../read';
import { forgetBrief, heldBrief } from '../token-holder';
import type { Brief } from '../types';

export type BriefState =
  | { kind: 'loading' }
  /** This page holds no token: reloaded, or opened without its link. */
  | { kind: 'none' }
  | BriefFailure
  | { kind: 'ready'; brief: Brief };

/**
 * The brief this page holds, read in the browser only: the server never sees the token (design
 * PD-124). The interface's language is asked for; the answer names none of its own (FR-104).
 * `retry` reads again: a reload would lose the token, which only memory holds.
 */
export function useBrief(): { state: BriefState; retry: () => void } {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const isHydrated = useIsHydrated();
  const token = useMemo(() => (isHydrated ? heldBrief() : null), [isHydrated]);
  const [state, setState] = useState<BriefState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token) return;
    let isCurrent = true;
    const api = createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => language });
    fetchBrief(api, token)
      .then((brief) => isCurrent && setState({ kind: 'ready', brief }))
      .catch((error: unknown) => {
        const failure = briefFailureOf(error);
        // A replaced link opens nothing again, so its token is dropped. A closed brief is kept:
        // one paused opens again when the hosts resume it (FR-108).
        if (failure.kind === 'gone') forgetBrief();
        if (isCurrent) setState(failure);
      });
    return () => {
      isCurrent = false;
    };
  }, [token, language, attempt]);
  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((count) => count + 1);
  };
  if (!isHydrated) return { state: { kind: 'loading' }, retry };
  return { state: token ? state : { kind: 'none' }, retry };
}
