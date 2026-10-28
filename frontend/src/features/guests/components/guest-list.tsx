import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath } from '@/features/events';

import type { GuestListData } from '../load';
import { GuestDirectory } from './guest-directory';

/**
 * An event's guests, grouped by household (docs/API.md §6, "Reading the guest list"; design PD-44).
 * A role that may not read them is told so here, with the event still named.
 */
export function GuestList({ data }: { data: GuestListData }) {
  const { t } = useTranslation('guests');
  const { event, households } = data;
  return (
    <section className="flex flex-col gap-5">
      <Link
        to={eventPath(event.id)}
        className="text-primary self-start underline underline-offset-4 hover:no-underline"
      >
        {t('list.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('list.title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      {households.kind === 'ready' ? (
        <GuestDirectory event={event} households={households.value} delivery={data.delivery} />
      ) : (
        <p className="m-0">{t('list.refused')}</p>
      )}
    </section>
  );
}
