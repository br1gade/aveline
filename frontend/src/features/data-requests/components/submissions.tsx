import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { listSubmissions } from '../api';
import type { Submission } from '../types';
import { useRequestDay } from './shared';

type Reading = 'idle' | 'loading' | 'failed';

/** Read only when asked, a page at a time, so a list of requests makes no read per card. */
function useSubmissions(requestId: string) {
  const [items, setItems] = useState<Submission[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [reading, setReading] = useState<Reading>('idle');
  const readMore = async () => {
    if (nextOffset === null) return;
    setReading('loading');
    try {
      const page = await listSubmissions(browserSession().api, requestId, nextOffset);
      setItems((held) => [...(held ?? []), ...page.items]);
      setNextOffset(page.hasMore ? page.nextOffset : null);
      setReading('idle');
    } catch (error) {
      if (!isApiError(error)) throw error;
      setReading('failed');
    }
  };
  return { items, hasMore: nextOffset !== null, reading, readMore: () => void readMore() };
}

/**
 * What the public form said for this request, each time it was sent (FR-126, design PD-168): marked
 * as not verified, as the form is public, and never offered as evidence of who sent it.
 */
export function Submissions({ requestId, who }: { requestId: string; who: string }) {
  const { t } = useTranslation('data-requests');
  const titleId = useId();
  const day = useRequestDay();
  const { items, hasMore, reading, readMore } = useSubmissions(requestId);
  return (
    // Not a landmark or a heading: every card has one, which would repeat the same region name.
    <div className="flex flex-col gap-2">
      <p id={titleId} className="m-0 text-sm font-medium">
        {t('submissions.title')}
      </p>
      {items?.length === 0 ? <p className="m-0 text-sm">{t('submissions.none')}</p> : null}
      {items && items.length > 0 ? (
        <ul aria-labelledby={titleId} className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => (
            <li key={item.id} className="border-border border-l-2 pl-3 text-sm">
              <p className="text-muted-foreground m-0">{day(item.createdAt)}</p>
              <p className="m-0 break-words whitespace-pre-wrap">
                {item.notes ?? t('submissions.noNotes')}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {hasMore ? (
        <Button
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          disabled={reading === 'loading'}
          aria-label={t('stepFor', {
            step: items ? t('submissions.more') : t('submissions.show'),
            who,
          })}
          onClick={readMore}
        >
          {items ? t('submissions.more') : t('submissions.show')}
        </Button>
      ) : null}
      {reading === 'failed' ? (
        <p role="alert" className="text-destructive m-0 text-sm">
          {t('submissions.failed')}
        </p>
      ) : null}
    </div>
  );
}
