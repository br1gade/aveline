import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath, ordersPath } from '@/features/events';
import { APP_PATHS } from '@/route-paths';
import { StatusLine, usePageStatus } from '@/ui/app-form';

import type { TicketSalesData } from '../load';
import { AnnouncementPanel } from './announcement-panel';
import { LINK } from './shared';
import { TicketTypesPanel } from './ticket-type-list';
import { VisibilityPanel } from './visibility-panel';

/**
 * Selling tickets for an event (docs/API.md §5, "Setting up ticket sales"; design PD-84): who can
 * find it, its announcement, and what is for sale. Every action is offered to every role, and a
 * 403 is worded when it happens (FR-6).
 */
export function TicketSalesPage({ data }: { data: TicketSalesData }) {
  const { t } = useTranslation('ticket-sales');
  const { page, status, statusRef } = usePageStatus(data);
  const { event } = data;
  return (
    <section className="flex flex-col gap-6">
      <Link to={eventPath(event.id)} className={LINK}>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <VisibilityPanel key={event.visibility ?? 'PRIVATE'} data={data} page={page} />
      <AnnouncementPanel data={data} page={page} />
      <TicketTypesPanel data={data} page={page} />
      <Link to={APP_PATHS.promoCodes} className={LINK}>
        {t('promoCodes')}
      </Link>
      <Link to={ordersPath(event.id)} className={LINK}>
        {t('toOrders')}
      </Link>
    </section>
  );
}
