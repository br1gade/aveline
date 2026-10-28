import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { InvitationStatus } from '@/features/events';
import { Button } from '@/ui/kit/button';

import { closeInvitation, reopenInvitation } from '../api';
import { refusalOf, type Refusal } from '../refusals';
import type { PageActions } from './page-status';
import { RefusalAlert } from './refusal-alert';

interface RepliesProps {
  slug: string;
  status: Extract<InvitationStatus, 'PUBLISHED' | 'CLOSED'>;
  /** Past its time: reopening succeeds, but guests still cannot open it (docs/API.md §6). */
  isExpired: boolean;
  page: PageActions;
}

/**
 * Stopping replies and taking them again (docs/API.md §6). Both are reversible, so neither asks
 * first; the words beside the button say what each does (design PD-47).
 */
export function RepliesPanel({ slug, status, isExpired, page }: RepliesProps) {
  const { t } = useTranslation('sending');
  const [isMoving, setIsMoving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const isOpen = status === 'PUBLISHED';
  const action = isOpen ? 'close' : 'reopen';

  const move = async () => {
    setRefusal(null);
    setIsMoving(true);
    try {
      const { api } = browserSession();
      await (isOpen ? closeInvitation(api, slug) : reopenInvitation(api, slug));
      await page.done(t(isOpen ? 'status.closed' : 'status.reopened'));
    } catch (error) {
      const found = refusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <section aria-labelledby="replies-title" className="flex max-w-[40rem] flex-col gap-3">
      <h2 id="replies-title" className="m-0 text-lg font-medium">
        {t('replies.title')}
      </h2>
      <p className="m-0">{t(isOpen ? 'replies.open' : 'replies.closed')}</p>
      {isExpired ? (
        <p className="text-muted-foreground m-0 text-sm">{t('replies.expired')}</p>
      ) : null}
      {refusal ? <RefusalAlert refusal={refusal} action={action} /> : null}
      <Button
        variant="outline"
        className="self-start"
        disabled={isMoving}
        onClick={() => void move()}
      >
        {t(isOpen ? 'replies.close' : 'replies.reopen')}
      </Button>
    </section>
  );
}
