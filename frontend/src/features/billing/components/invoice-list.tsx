import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMinor } from '@/lib/money';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { BillingData } from '../load';
import type { Invoice } from '../types';
import { BillingProblem, useBillingDay } from './shared';

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

/** Each line is the backend's English sentence, captured at issue (FR-110). */
function Lines({ invoice }: { invoice: Invoice }) {
  const { t, i18n } = useTranslation('billing');
  const money = (minor: string) => formatMinor(minor, invoice.currency, i18n.language);
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {invoice.lines.map((line, position) => (
          <li key={position} className="flex flex-wrap justify-between gap-x-3">
            <span lang="en" className="min-w-0 break-words">
              {line.description}
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

/**
 * Invoices, newest first, opened in place: the list already holds each whole (design PD-129). "Pay"
 * on an open one asks for the same plan again, which answers the same invoice with a payment that
 * can still be made (docs/API.md §6).
 */
export function InvoiceList({ read, onPay }: InvoiceListProps) {
  const { t, i18n } = useTranslation('billing');
  const body = () => {
    if (read.kind === 'refused') return <BillingProblem refusal={read.refusal} />;
    if (read.value.length === 0) return <p className="m-0">{t('invoices.none')}</p>;
    return (
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {read.value.map((invoice) => {
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
    );
  };
  return (
    <section aria-labelledby="billing-invoices" className="flex flex-col gap-3">
      <h2 id="billing-invoices" className="m-0 text-lg font-medium">
        {t('invoices.title')}
      </h2>
      <p className="m-0 text-sm">{t('invoices.zone')}</p>
      {body()}
    </section>
  );
}
