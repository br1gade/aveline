import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import type { Basket } from '@/features/public-event';
import { formatMinor } from '@/lib/money';
import { Button } from '@/ui';
import { TextField } from '@/ui/form';

import { checkPromoCode } from '../api';
import { promoRefusal } from '../refusals';
import type { PromoQuote } from '../types';
import { useCheckoutSetting } from './checkout-context';
import { useCheckoutApi } from './use-checkout-api';

type Problem =
  | { kind: 'refused'; sentence: string }
  | { kind: 'failed'; requestId?: string | undefined }
  | { kind: 'busy' };

/** A refusal is an answer, said as it came; only no answer or a server failure is worth a retry. */
function problemOf(error: unknown): Problem {
  if (!isApiError(error)) return { kind: 'failed' };
  if (error.status === 429) return { kind: 'busy' };
  if (error.status >= 400 && error.status < 500) {
    return { kind: 'refused', sentence: error.messages[0] ?? '' };
  }
  return { kind: 'failed', requestId: error.requestId };
}

/** The backend's sentence in our words where we know it; otherwise as it came, marked English. */
function ProblemText({ problem }: { problem: Problem }) {
  const { t } = useTranslation('checkout');
  const { event } = useCheckoutSetting();
  if (problem.kind === 'busy') return t('promo.busy');
  if (problem.kind === 'failed') return t('promo.failed', { requestId: problem.requestId ?? '—' });
  const known = promoRefusal(problem.sentence);
  if (!known) return <span lang="en">{problem.sentence}</span>;
  if (known.reason !== 'minimum') return t(`promo.reasons.${known.reason}`);
  const currency = event.ticketTypes[0]?.currency ?? 'AMD';
  return t('promo.reasons.minimum', {
    amount: formatMinor(known.minimumMinor, currency, event.locale),
  });
}

function usePromoCheck(basket: Basket, onQuote: (quote: PromoQuote) => void) {
  const { event } = useCheckoutSetting();
  const api = useCheckoutApi(event.locale);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  async function check(code: string) {
    setIsChecking(true);
    setProblem(null);
    try {
      const quote = await checkPromoCode(api, event.slug, { code, items: basket });
      if (quote.isApplicable) onQuote(quote);
      else setProblem({ kind: 'refused', sentence: quote.reason ?? '' });
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setIsChecking(false);
    }
  }
  return { problem, isChecking, check };
}

function AppliedCode({ quote, onRemove }: { quote: PromoQuote; onRemove: () => void }) {
  const { t } = useTranslation('checkout');
  const { event, isBusy } = useCheckoutSetting();
  const amount = formatMinor(quote.discountMinor, quote.currency, event.locale);
  return (
    <>
      <p role="status" className="m-0">
        {t('promo.applied', { code: quote.code, amount })}
      </p>
      <Button variant="quiet" className="justify-self-start" disabled={isBusy} onClick={onRemove}>
        {t('promo.remove')}
      </Button>
    </>
  );
}

interface PromoCodeProps {
  basket: Basket;
  quote: PromoQuote | null;
  onQuote: (quote: PromoQuote | null) => void;
}

/**
 * A promo code, checked against this basket by the server before the order (docs/API.md §6,
 * "Checking a promo code before checkout"). The check is a preview: the code is claimed again with
 * the order, and can run out in between.
 */
export function PromoCode({ basket, quote, onQuote }: PromoCodeProps) {
  const { t } = useTranslation('checkout');
  const { isBusy } = useCheckoutSetting();
  const [code, setCode] = useState('');
  const promo = usePromoCheck(basket, onQuote);
  const isEmpty = code.trim() === '';
  return (
    <section aria-labelledby="promo-heading" className="grid gap-3">
      <h2 id="promo-heading" className="type-heading-3 text-heading m-0">
        {t('promo.heading')}
      </h2>
      {quote ? (
        <AppliedCode quote={quote} onRemove={() => onQuote(null)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField
            label={t('promo.label')}
            optionalText={t('fields.optional')}
            maxLength={32}
            value={code}
            autoComplete="off"
            onChange={(change) => setCode(change.target.value)}
          />
          <Button
            variant="secondary"
            disabled={promo.isChecking || isBusy || isEmpty}
            aria-busy={promo.isChecking}
            onClick={() => void promo.check(code.trim())}
          >
            {t('promo.apply')}
          </Button>
        </div>
      )}
      {promo.problem && !quote ? (
        <p role="alert" className="text-error m-0 text-sm">
          <ProblemText problem={promo.problem} />
        </p>
      ) : null}
    </section>
  );
}
