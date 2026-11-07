import { useId, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { offerFor } from '../plans';
import type { Entitlements, Plan, Subscription } from '../types';
import { usePrice } from './shared';

function Limits({ entitlements }: { entitlements: Entitlements }) {
  const { t } = useTranslation('billing');
  const { maxEventsPerPeriod, maxGuestsPerEvent, maxLocales, invitationLifetimeDays, features } =
    entitlements;
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
      <li>
        {maxEventsPerPeriod === null
          ? t('limits.eventsAny')
          : t('limits.events', { count: maxEventsPerPeriod })}
      </li>
      <li>
        {maxGuestsPerEvent === null
          ? t('limits.guestsAny')
          : t('limits.guests', { count: maxGuestsPerEvent })}
      </li>
      <li>{t('limits.languages', { count: maxLocales })}</li>
      <li>
        {invitationLifetimeDays === null
          ? t('limits.lifetimeAny')
          : t('limits.lifetime', { count: invitationLifetimeDays })}
      </li>
      {features.map((feature) => (
        <li key={feature} lang="en">
          {feature}
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ plan, action }: { plan: Plan; action: ReactNode }) {
  const price = usePrice();
  const nameId = useId();
  return (
    <li aria-labelledby={nameId} className="border-border flex flex-col gap-3 border p-4">
      <p id={nameId} lang="en" className="m-0 text-lg font-medium break-words">
        {plan.name}
      </p>
      <p className="m-0">{price(plan.priceMinor, plan.currency, plan.interval)}</p>
      <Limits entitlements={plan.entitlements} />
      {action}
    </li>
  );
}

/**
 * Each plan with its price and limits, and what can be done with it. A plan's name and features
 * are English sentences the backend holds in no other language (FR-110).
 */
export function PlanCards({
  plans,
  action,
}: {
  plans: readonly Plan[];
  action: (plan: Plan) => ReactNode;
}) {
  const { t } = useTranslation('billing');
  return (
    <>
      {plans.length === 0 ? <p className="m-0">{t('plans.none')}</p> : null}
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {plans.map((plan) => (
          <PlanCard key={plan.key} plan={plan} action={action(plan)} />
        ))}
      </ul>
    </>
  );
}

interface PlanListProps {
  plans: readonly Plan[];
  current: Subscription | null;
  now: number;
  onChoose: (plan: Plan, opener: MouseEvent<HTMLElement>) => void;
}

/**
 * The price list (design PD-126): every plan is offered to every role, and a refusal is worded
 * (FR-6); only the one running now isn't, as choosing it would start a new period.
 */
export function PlanList({ plans, current, now, onChoose }: PlanListProps) {
  const { t } = useTranslation('billing');
  return (
    <section aria-labelledby="billing-plans" className="flex flex-col gap-3">
      <h2 id="billing-plans" className="m-0 text-lg font-medium">
        {t('plans.title')}
      </h2>
      <PlanCards
        plans={plans}
        action={(plan) =>
          offerFor(plan, current, now) === 'current' ? (
            <p className="m-0 mt-auto font-medium">{t('plans.current')}</p>
          ) : (
            <Button
              variant="outline"
              className={`${WRAPPING_BUTTON} mt-auto self-start`}
              onClick={(opener) => onChoose(plan, opener)}
            >
              {t('plans.choose')}
            </Button>
          )
        }
      />
    </section>
  );
}
