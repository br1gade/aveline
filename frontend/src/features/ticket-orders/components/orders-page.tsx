import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { eventPath, ticketSalesPath } from '@/features/events';
import { formatMinor } from '@/lib/money';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { cn } from '@/ui/cn';
import { ProblemAlert, StatusLine, usePageStatus, type PageActions } from '@/ui/app-form';

import type { OrdersData } from '../load';
import { ORDER_TABS, type OrderTab } from '../status';
import type { OrderRow } from '../types';
import { OrderPanel } from './order-panel';

const LINK = 'text-primary self-start underline underline-offset-4 hover:no-underline';
/** The API's own cap on one read of the list (FR-68). */
const LIST_CAP = 500;

function useSearchFor() {
  const [search] = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return text ? `?${text}` : '?';
  };
}

function Tabs({ current }: { current: OrderTab }) {
  const { t } = useTranslation('ticket-orders');
  const searchFor = useSearchFor();
  return (
    <nav aria-label={t('tabs.label')}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {ORDER_TABS.map((tab) => (
          <li key={tab}>
            <Link
              to={searchFor({ status: tab === 'all' ? null : tab, order: null })}
              aria-current={tab === current ? 'page' : undefined}
              preventScrollReset
              replace
              className={cn(
                'border-border inline-flex min-h-10 items-center border px-3 text-sm',
                tab === current && 'bg-primary text-primary-foreground',
              )}
            >
              {t(`tabs.${tab}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function RowItem({ row, data, page }: { row: OrderRow; data: OrdersData; page: PageActions }) {
  const { t, i18n } = useTranslation('ticket-orders');
  const searchFor = useSearchFor();
  const zone = { timeZone: data.event.timezone, locale: i18n.language };
  const isOpen = data.opened?.id === row.id;
  const total =
    row.totalMinor === '0' ? t('free') : formatMinor(row.totalMinor, row.currency, i18n.language);
  const email = row.buyerEmail.kind === 'shown' ? row.buyerEmail.value : null;
  return (
    <li className="bg-card border-border flex flex-col gap-1 border px-5 py-4">
      <h2 className="m-0 text-base font-medium break-words">{row.buyerName}</h2>
      {email ? <p className="m-0 text-sm break-words">{email}</p> : null}
      <p className="m-0 text-sm">
        {t(`orderStatus.${row.status}`)} · {t('row.tickets', { count: row.ticketCount })} · {total}
      </p>
      {row.discountMinor !== '0' ? (
        <p className="m-0 text-sm">
          {t('row.discount', {
            amount: formatMinor(row.discountMinor, row.currency, i18n.language),
          })}
        </p>
      ) : null}
      <p className="text-muted-foreground m-0 text-sm">
        {t('row.placed', {
          date: formatEventDate(row.createdAt, zone),
          time: formatEventTime(row.createdAt, zone),
        })}
      </p>
      <Link
        to={searchFor({ order: isOpen ? null : row.id })}
        preventScrollReset
        replace
        aria-expanded={isOpen}
        className={LINK}
      >
        {t(isOpen ? 'row.close' : 'row.open')}
      </Link>
      {isOpen && data.opened ? (
        <OrderPanel data={data} opened={data.opened} row={row} page={page} />
      ) : null}
    </li>
  );
}

function List({ data, page }: { data: OrdersData; page: PageActions }) {
  const { t } = useTranslation('ticket-orders');
  const { orders } = data;
  if (orders.kind === 'refused') return <p className="m-0">{t('refused')}</p>;
  if (orders.kind === 'failed')
    return <ProblemAlert problem={orders.problem} refused={() => t('failed')} />;
  const rows = orders.value;
  const isOpenElsewhere = data.opened && !rows.some((row) => row.id === data.opened?.id);
  return (
    <>
      {rows.some((row) => row.buyerEmail.kind === 'hidden') ? (
        <p className="text-muted-foreground m-0 text-sm">{t('emailsHidden')}</p>
      ) : null}
      {isOpenElsewhere && data.opened ? (
        <OrderPanel data={data} opened={data.opened} row={undefined} page={page} />
      ) : null}
      {rows.length === 0 ? (
        <p className="text-muted-foreground m-0">{t(data.tab === 'all' ? 'empty' : 'emptyTab')}</p>
      ) : (
        <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
          {rows.map((row) => (
            <RowItem key={row.id} row={row} data={data} page={page} />
          ))}
        </ul>
      )}
      {rows.length >= LIST_CAP ? (
        <p className="text-muted-foreground m-0 text-sm">{t('capped', { count: LIST_CAP })}</p>
      ) : null}
    </>
  );
}

/**
 * An event's ticket orders (docs/API.md §5; design PD-87): by status, newest first, each opened in
 * place with its people and tickets, cancelling and reconciling. Every action is offered to every
 * role, and a 403 is worded when it happens (FR-6).
 */
export function OrdersPage({ data }: { data: OrdersData }) {
  const { t } = useTranslation('ticket-orders');
  const { page, status, statusRef } = usePageStatus(data);
  const { event } = data;
  return (
    <section className="flex flex-col gap-5">
      <Link to={eventPath(event.id)} className={LINK}>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <Link to={ticketSalesPath(event.id)} className={LINK}>
        {t('toSales')}
      </Link>
      <Tabs current={data.tab} />
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <List data={data} page={page} />
    </section>
  );
}
