import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/ui';
import { Alert, AlertDescription } from '@/ui/kit/alert';

import type { Problem } from '@/api/problems';

interface ProblemAlertProps {
  /**
   * One object per failure, kept across renders (state, or memoised): a new object is a new
   * problem, which takes the focus again and starts its "connected again" over.
   */
  problem: Problem;
  /** The page's own words for a refusal (400, 401, 409), which differ from page to page. */
  refused: (status: number) => ReactNode;
}

/**
 * Whether the browser came back online since this problem appeared, so "we couldn't reach
 * Aveline" doesn't stay once it could (audit F-35). Only listened for on that problem.
 */
function useBackOnline(problem: Problem): boolean {
  // The problem the connection came back for: a new problem starts over without a reset.
  const [backOnlineFor, setBackOnlineFor] = useState<Problem | null>(null);
  useEffect(() => {
    if (problem.code !== 'unreachable') return undefined;
    const backOnline = () => setBackOnlineFor(problem);
    window.addEventListener('online', backOnline);
    return () => window.removeEventListener('online', backOnline);
  }, [problem]);
  return backOnlineFor === problem;
}

/**
 * Why a submission failed, in words and with an icon. It takes the focus when it appears, so
 * a keyboard or screen-reader user meets it at once. A server failure shows the request id, which
 * maps a report to the exact request (docs/API.md §1).
 */
export function ProblemAlert({ problem, refused }: ProblemAlertProps) {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [problem]);
  const isBackOnline = useBackOnline(problem);

  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1} className="outline-none">
      <Icon name="circle-alert" size={16} />
      <AlertDescription>
        {problem.code === 'refused'
          ? refused(problem.status)
          : t(isBackOnline ? 'problems.reconnected' : `problems.${problem.code}`)}
        {problem.code === 'server' && problem.requestId ? (
          <span className="block">{t('error.reference', { requestId: problem.requestId })}</span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
