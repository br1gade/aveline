import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMinor } from '@/lib/money';
import { browserSession } from '@/api/session';
import { MoreButton, useMoreByCursor, WRAPPING_BUTTON, type CursorPage } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { listInvoices } from '../api';
import type { BillingData } from '../load';
import type { Invoice } from '../types';
import { BillingProblem, useBillingDay, wordsLanguage } from './shared';

function Dates({ invoice }: { invoice: Invoice }) {
  const { t } = useTranslation('billing');
  const day = useBillingDay();
  const dates = [
    invoice.issuedAt && t('invoices.issued', { date: day(invoice.issuedAt) }),
    invoice.dueAt && invoice.status === 'ISSUED' && t('invoices.due', { date: day(invoice.dueAt) }),
    invoice.paidAt && t('invoices.paid', { date: day(invoice.paidAt) }),
  ].filter(Boolean);
  return <p className="m-0 text-sm">{dates.join(' · ')}</p>;
}

/**
 * Each line in the language asked, as captured at issue; one issued before translations is the
 * backend's English sentence (FR-110).
 */
function Lines({ invoice }: { invoice: Invoice }) {
  const { t, i18n } = useTranslation('billing');
  const money = (minor: string) => formatMinor(minor, invoice.currency, i18n.language);
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {invoice.lines.map((line, position) => (
          <li key={position} className="flex flex-wrap justify-between gap-x-3">
            <span
              lang={wordsLanguage(line.display?.locale ?? null)}
              className="min-w-0 break-words"
            >
              {line.display?.description ?? line.description}
            </span>
            <span>{money(line.totalMinor)}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-sm">{t('invoices.notTax')}</p>
    </>
  );
}

const KNOWN_STATUSES = ['ISSUED', 'PAID', 'VOID', 'DRAFT', 'UNCOLLECTIBLE'] as const;

function statusWord(status: string): (typeof KNOWN_STATUSES)[number] | 'OTHER' {
  return KNOWN_STATUSES.find((known) => known === status) ?? 'OTHER';
}

interface InvoiceListProps {
  read: BillingData['invoices'];
  onPay: (invoice: Invoice, planKey: string, opener: MouseEvent<HTMLElement>) => void;
}

/** The first page of invoices, and the next ones by the cursor (FR-110). */
function Invoices({
  first,
  onPay,
}: {
  first: CursorPage<Invoice>;
  onPay: InvoiceListProps['onPay'];
}) {
  const { t, i18n } = useTranslation('billing');
  const { items, hasMore, isLoading, error, more } = useMoreByCursor(first, (cursor) =>
    listInvoices(browserSession().api, { cursor }),
  );
  if (items.length === 0) return <p className="m-0">{t('invoices.none')}</p>;
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((invoice) => {
          const planKey = invoice.lines[0]?.planKey;
          return (
            <li key={invoice.number} className="border-border border">
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 px-3 py-2">
                  <span className="font-medium break-all">{invoice.number}</span>
                  <span>{t(`invoiceStatus.${statusWord(invoice.status)}`)}</span>
                  <span>{formatMinor(invoice.totalMinor, invoice.currency, i18n.language)}</span>
                </summary>
                <div className="flex flex-col gap-2 px-3 pb-3">
                  <Dates invoice={invoice} />
                  <Lines invoice={invoice} />
                </div>
              </details>
              {invoice.status === 'ISSUED' && planKey ? (
                <div className="px-3 pb-3">
                  <Button
                    variant="outline"
                    className={WRAPPING_BUTTON}
                    onClick={(opener) => onPay(invoice, planKey, opener)}
                  >
                    {t('invoices.pay')}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <MoreButton
          label={t('invoices.more')}
          failed={t('invoices.moreFailed')}
          isLoading={isLoading}
          hasFailed={error !== null}
          onPress={more}
        />
      ) : null}
    </>
  );
}

/**
 * Invoices, newest first, opened in place: the list already holds each whole (design PD-129). "Pay"
 * on an open one asks for the same plan again, which answers the same invoice with a payment that
 * can still be made (docs/API.md §6).
 */
export function InvoiceList({ read, onPay }: InvoiceListProps) {
  const { t } = useTranslation('billing');
  return (
    <section aria-labelledby="billing-invoices" className="flex flex-col gap-3">
      <h2 id="billing-invoices" className="m-0 text-lg font-medium">
        {t('invoices.title')}
      </h2>
      <p className="m-0 text-sm">{t('invoices.zone')}</p>
      {read.kind === 'refused' ? (
        <BillingProblem refusal={read.refusal} />
      ) : (
        <Invoices first={read.value} onPay={onPay} />
      )}
    </section>
  );
}
