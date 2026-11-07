import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/ui';
import { Alert, AlertDescription } from '@/ui/kit/alert';

import type { Problem } from '@/api/problems';

interface ProblemAlertProps {
  problem: Problem;
  /** The page's own words for a refusal (400, 401, 409), which differ from page to page. */
  refused: (status: number) => ReactNode;
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

  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1} className="outline-none">
      <Icon name="circle-alert" size={16} />
      <AlertDescription>
        {problem.code === 'refused' ? refused(problem.status) : t(`problems.${problem.code}`)}
        {problem.code === 'server' && problem.requestId ? (
          <span className="block">{t('error.reference', { requestId: problem.requestId })}</span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
