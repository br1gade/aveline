import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { ProblemAlert, StatusLine, WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { requestEmailConfirmation } from '../api';

function useNewLink() {
  const [isSending, setIsSending] = useState(false);
  const [wasSent, setWasSent] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const send = async () => {
    setIsSending(true);
    setProblem(null);
    setWasSent(false);
    try {
      await requestEmailConfirmation(browserSession().api);
      setWasSent(true);
    } catch (error) {
      setProblem(problemFrom(error));
    } finally {
      setIsSending(false);
    }
  };
  return { isSending, wasSent, problem, send };
}

/**
 * An address not yet confirmed (FR-5, design PD-191): a line on every signed-in page, never a wall,
 * as nothing in the app waits on it yet. It goes on the next page once the address is confirmed.
 */
export function EmailConfirmationNotice({ email }: { email: string }) {
  const { t } = useTranslation('app');
  const link = useNewLink();
  const statusRef = useRef<HTMLParagraphElement>(null);
  return (
    <div className="border-border flex flex-col items-start gap-2 rounded-md border p-4">
      <p className="m-0 break-words">{t('shell.unconfirmed.body', { email })}</p>
      <Button
        variant="outline"
        className={WRAPPING_BUTTON}
        disabled={link.isSending}
        onClick={() => void link.send()}
      >
        {t('shell.unconfirmed.send')}
      </Button>
      {link.problem ? (
        <ProblemAlert problem={link.problem} refused={() => t('shell.unconfirmed.failed')} />
      ) : null}
      <StatusLine statusRef={statusRef}>
        {link.wasSent ? t('shell.unconfirmed.sent', { email }) : ''}
      </StatusLine>
    </div>
  );
}
