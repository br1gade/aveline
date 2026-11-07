import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { Button } from '@/ui/kit/button';

import { setSeatingPublished } from '../api';
import { refusalOf } from '../refusals';
import { PANEL, useEventMoment, WRAP } from './shared';
import type { SeatingHost } from './use-seating-host';

/** Guests read their table on their personal link, which opens only once published, until it expires. */
function isOpenToGuests({ invitation }: EventDetail): boolean {
  return invitation !== null && invitation.status !== 'DRAFT' && invitation.isExpired !== true;
}

/**
 * Whether guests see their own household's tables on their personal links (design PD-71). Neither
 * press asks first: both can be undone at once, and the words beside them say what each does.
 */
export function PublishPanel({ event, host }: { event: EventDetail; host: SeatingHost }) {
  const { t } = useTranslation('seating');
  const moment = useEventMoment(event.timezone);
  const [isSending, setIsSending] = useState(false);
  const publishedAt = event.seatingPublishedAt ?? null;
  const isPublished = publishedAt !== null;

  const toggle = async () => {
    host.refuse(null);
    setIsSending(true);
    try {
      await setSeatingPublished(browserSession().api, event.id, !isPublished);
      await host.announce(t(isPublished ? 'status.unpublished' : 'status.published'));
    } catch (error) {
      const refusal = refusalOf(error, isPublished ? 'unpublish' : 'publish');
      host.refuse(refusal);
      if (refusal.isStale) host.reload();
    } finally {
      setIsSending(false);
    }
  };

  const busy = isPublished ? t('publish.hiding') : t('publish.showing');
  return (
    <section aria-labelledby="seating-publish" className={PANEL}>
      <h2 id="seating-publish" className="m-0 text-lg font-medium">
        {t('publish.title')}
      </h2>
      <p className="m-0">
        {publishedAt ? t('publish.since', { when: moment(publishedAt) }) : t('publish.notYet')}
      </p>
      <p className="text-muted-foreground m-0 text-sm">{t('publish.live')}</p>
      {isOpenToGuests(event) ? null : <p className="m-0 text-sm">{t('publish.notOpen')}</p>}
      <Button
        variant={isPublished ? 'outline' : 'default'}
        className={`self-start ${WRAP}`}
        disabled={isSending}
        onClick={() => void toggle()}
      >
        {isSending ? busy : t(isPublished ? 'publish.hide' : 'publish.show')}
      </Button>
    </section>
  );
}
