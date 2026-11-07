import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRevalidator } from 'react-router';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { bankAddress, leaveForBank } from '@/lib/links';
import { APP_PATHS } from '@/route-paths';
import { Notice, type NoticeTone } from '@/ui';
import { SupportContacts } from '@/ui/support-contacts';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { choosePlan } from '../api';
import type { ReturnRead } from '../load';
import { billingRefusalOf, type BillingRefusal } from '../refusals';
import { returnOutcome, type ReturnOutcome } from '../return-outcome';
import type { Invoice, PaymentProvider } from '../types';
import { PilotNotice } from './pilot-notice';
import { BillingProblem } from './shared';

const TONES: Readonly<Record<ReturnOutcome, NoticeTone>> = {
  paid: 'success',
  awaitingBank: 'info',
  notPaid: 'error',
  replaced: 'info',
  replacedOpen: 'info',
  refunded: 'info',
  closed: 'info',
};

/** A payment that ended without money: the same plan again answers with one that can be made. */
function PayAgain({ invoice, provider }: { invoice: Invoice; provider: PaymentProvider }) {
  const { t } = useTranslation('billing');
  const [refusal, setRefusal] = useState<BillingRefusal | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const planKey = invoice.lines[0]?.planKey;
  if (!planKey) return null;
  const payAgain = async () => {
    setRefusal(null);
    setIsBusy(true);
    try {
      const made = await choosePlan(browserSession().api, planKey, provider);
      const address = made.kind === 'bank' && bankAddress(made.redirectUrl, window.location.origin);
      if (address) leaveForBank(address);
      else setRefusal({ kind: 'noBank' });
    } catch (error) {
      setRefusal(billingRefusalOf(error));
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <>
      <Button
        className={`${WRAPPING_BUTTON} self-start`}
        disabled={isBusy}
        onClick={() => void payAgain()}
      >
        {t('return.payAgain')}
      </Button>
      {refusal?.kind === 'pilot' ? <PilotNotice /> : null}
      {refusal && refusal.kind !== 'pilot' ? <BillingProblem refusal={refusal} /> : null}
    </>
  );
}

function CheckAgain({ labelKey }: { labelKey: 'return.checkAgain' | 'return.tryAgain' }) {
  const { t } = useTranslation('billing');
  const { revalidate, state } = useRevalidator();
  return (
    <Button
      className={`${WRAPPING_BUTTON} self-start`}
      disabled={state === 'loading'}
      onClick={() => void revalidate()}
    >
      {t(labelKey)}
    </Button>
  );
}

function Confirmed({ invoice, provider }: { invoice: Invoice; provider: PaymentProvider }) {
  const { t } = useTranslation('billing');
  const outcome = returnOutcome(invoice);
  return (
    <>
      <Notice role="status" tone={TONES[outcome]}>
        {t(`return.${outcome}`)}
      </Notice>
      {outcome === 'awaitingBank' ? <CheckAgain labelKey="return.checkAgain" /> : null}
      {outcome === 'notPaid' ? <PayAgain invoice={invoice} provider={provider} /> : null}
    </>
  );
}

/**
 * The bank disagreeing with our record is never met with a new payment, and says whom to contact
 * (docs/API.md §6; design C-54).
 */
function Refused({ refusal }: { refusal: BillingRefusal }) {
  const { t } = useTranslation('billing');
  return (
    <>
      <BillingProblem refusal={refusal} />
      {refusal.kind === 'disagreement' ? (
        <>
          <p className="m-0">{t('return.dontPayAgain')}</p>
          <SupportContacts linkClassName="text-primary underline underline-offset-4" />
        </>
      ) : null}
      {refusal.kind === 'noAnswer' || refusal.kind === 'rateLimited' ? (
        <CheckAgain labelKey="return.tryAgain" />
      ) : null}
    </>
  );
}

/**
 * Back from the bank (docs/API.md §6; design PD-130). The return proves nothing: what the page says
 * comes from confirm alone, which asks the bank server to server.
 */
export function BillingReturnPage({
  read,
  provider,
}: {
  read: ReturnRead;
  provider: PaymentProvider;
}) {
  const { t } = useTranslation('billing');
  return (
    <section className="flex max-w-[40rem] flex-col gap-4">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('return.title')}</h1>
      {read.kind === 'nothing' ? <p className="m-0">{t('return.nothing')}</p> : null}
      {read.kind === 'confirmed' ? <Confirmed invoice={read.invoice} provider={provider} /> : null}
      {read.kind === 'refused' ? <Refused refusal={read.refusal} /> : null}
      <Link
        to={APP_PATHS.billing}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('return.toBilling')}
      </Link>
    </section>
  );
}

/**
 * The page couldn't even start: a failure with no answer from anyone, which must not read as a
 * refused payment, or invite paying again.
 */
export function BillingReturnFailed({ error }: { error: unknown }) {
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <BillingReturnPage
      read={{ kind: 'refused', refusal: { kind: 'noAnswer', requestId } }}
      provider={undefined}
    />
  );
}
