import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  basketParam,
  ticketCount,
  type Basket,
  type CheckoutRules,
  type PublicEvent,
} from '@/features/public-event';

import { isComing } from '../attendance';
import type { CheckoutRefusal } from '../refusals';
import { rosterFor } from '../roster';
import { checkoutSchema } from '../schemas';
import type { CheckoutValues, PaymentProvider, PromoQuote } from '../types';
import { AttendeeCard } from './attendee-card';
import { BasketSummary } from './basket-summary';
import { BuyerFields } from './buyer-fields';
import { CheckoutContext } from './checkout-context';
import { PlaceOrder } from './place-order';
import { PromoCode } from './promo-code';
import { useCheckout } from './use-checkout';

type Form = UseFormReturn<CheckoutValues>;

/** A refusal that names fields marks them; a required answer marks everyone coming without it. */
function markRefused(form: Form, rules: CheckoutRules, refusal: CheckoutRefusal) {
  if (refusal.kind === 'fields') {
    for (const path of refusal.paths) form.setError(path as 'buyerEmail', { message: 'refused' });
  }
  if (refusal.kind === 'requiredAnswer') {
    form.getValues('people').forEach((person, index) => {
      if (isComing(rules, person) && !person.answers[refusal.questionId]) {
        form.setError(`people.${index}.answers.${refusal.questionId}`, { message: 'required' });
      }
    });
  }
}

/** When the hosts changed how guests answer, each person chooses again; everything else is kept. */
function useRevisionReset(form: Form, revision: number) {
  const first = useRef(revision);
  useEffect(() => {
    if (first.current === revision) return;
    first.current = revision;
    form.getValues('people').forEach((_, index) => form.setValue(`people.${index}.venues`, {}));
  }, [form, revision]);
}

/**
 * When the event is read again after a refusal, fewer tickets may remain: the basket follows what
 * is left, and the people follow the basket, each keeping their place within their type.
 */
function useBasketSync(form: Form, basket: Basket, key: string, onChanged: () => void) {
  const first = useRef(key);
  useEffect(() => {
    if (first.current === key) return;
    first.current = key;
    form.setValue('people', rosterFor(basket, form.getValues('people')));
    onChanged();
  }, [form, basket, key, onChanged]);
}

function AgreementsAhead({ rules }: { rules: CheckoutRules }) {
  const { t } = useTranslation('checkout');
  if (rules.agreementsBeforeDoor.length === 0) return null;
  return (
    <section aria-labelledby="agreements-heading" className="grid gap-3">
      <h2 id="agreements-heading" className="type-heading-3 text-heading m-0">
        {t('agreements.heading')}
      </h2>
      <p className="m-0">{t('agreements.lead')}</p>
      <ul className="m-0 grid gap-1 pl-5">
        {rules.agreementsBeforeDoor.map((agreement) => (
          <li key={agreement.questionId}>{agreement.prompt ?? t('agreements.untitled')}</li>
        ))}
      </ul>
      <p className="text-text-muted m-0 text-sm">{t('agreements.noEmail')}</p>
    </section>
  );
}

function People({ count }: { count: number }) {
  const { t } = useTranslation('checkout');
  return (
    <section aria-labelledby="people-heading" className="grid gap-5">
      <div className="grid gap-2">
        <h2 id="people-heading" className="type-heading-2 text-heading m-0">
          {t('people.heading')}
        </h2>
        <p className="text-text-muted m-0 text-sm">{t('people.lead')}</p>
      </div>
      {Array.from({ length: count }, (_, index) => (
        <AttendeeCard key={index} index={index} total={count} />
      ))}
    </section>
  );
}

export interface CheckoutFormProps {
  event: PublicEvent;
  basket: Basket;
  provider: PaymentProvider;
}

/** Checkout's one form (design PD-79): posted from JavaScript, never by the browser (PD-41). */
export function CheckoutForm({ event, basket, provider }: CheckoutFormProps) {
  const rules = event.checkout;
  const schema = useMemo(() => checkoutSchema(rules), [rules]);
  const form = useForm<CheckoutValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      buyerFirstName: '',
      buyerLastName: '',
      buyerEmail: '',
      buyerPhone: '',
      people: rosterFor(basket),
    },
  });
  const [quote, setQuote] = useState<PromoQuote | null>(null);
  const checkout = useCheckout({ event, basket, provider });
  const { refusal } = checkout;
  const place = async (values: CheckoutValues) => {
    const refused = await checkout.submit(values, quote?.code ?? null);
    if (!refused) return;
    markRefused(form, rules, refused);
    if (refused.kind === 'promo') setQuote(null);
  };
  useRevisionReset(form, rules.attendanceRevision);
  // A promo quote priced the basket as it was; the order is claimed again at the new total.
  const dropQuote = useCallback(() => setQuote(null), []);
  useBasketSync(form, basket, basketParam(basket, event.ticketTypes), dropQuote);
  const setting = useMemo(
    () => ({ event, rules, isBusy: checkout.isSending }),
    [event, rules, checkout.isSending],
  );
  const count = ticketCount(basket);
  return (
    <CheckoutContext.Provider value={setting}>
      <FormProvider {...form}>
        <form
          method="post"
          noValidate
          className="grid gap-10"
          onSubmit={(submitted) => void form.handleSubmit(place)(submitted)}
        >
          <BasketSummary basket={basket} />
          <BuyerFields />
          <People count={count} />
          <AgreementsAhead rules={rules} />
          <PromoCode basket={basket} quote={quote} onQuote={setQuote} />
          <PlaceOrder basket={basket} quote={quote} refusal={refusal} />
        </form>
      </FormProvider>
    </CheckoutContext.Provider>
  );
}
