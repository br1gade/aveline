import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { ROUTE_PATHS } from '@/route-paths';

import { confirmEmail } from '../api';
import { problemFrom, type Problem } from '../problems';
import { useLinkToken } from '../use-link-token';
import { AccountLayout } from './account-layout';
import { AccountLink } from './account-link';
import { ProblemAlert } from './problem-alert';

type Outcome = 'pending' | 'done' | Problem;

/**
 * Confirms once, as soon as the page is in the browser. The link is single-use, so the request is
 * guarded against a second run (React runs effects twice in development).
 */
function useEmailConfirmation(token: string | null): Outcome {
  const [outcome, setOutcome] = useState<Outcome>('pending');
  const hasStarted = useRef(false);

  useEffect(() => {
    if (!token || hasStarted.current) return;
    hasStarted.current = true;
    confirmEmail(browserSession().publicApi, token).then(
      () => setOutcome('done'),
      (error: unknown) => setOutcome(problemFrom(error)),
    );
  }, [token]);

  return outcome;
}

export function VerifyEmail() {
  const { t } = useTranslation('account');
  const token = useLinkToken();
  const outcome = useEmailConfirmation(token);

  const message = (() => {
    if (!token) return <p className="m-0">{t('verifyEmail.missing')}</p>;
    if (typeof outcome === 'object') {
      return <ProblemAlert problem={outcome} refused={() => t('verifyEmail.invalid')} />;
    }
    return (
      <p className="m-0" role="status">
        {t(`verifyEmail.${outcome}`)}
      </p>
    );
  })();

  return (
    <AccountLayout
      title={t('verifyEmail.title')}
      footer={<AccountLink to={ROUTE_PATHS.signIn}>{t('links.signIn')}</AccountLink>}
    >
      {message}
    </AccountLayout>
  );
}
