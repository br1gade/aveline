import { useId, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { useCan } from '@/features/permissions';

import { isFree, offerFor } from '../plans';
import type { Entitlements, Plan, Subscription } from '../types';
import { usePrice } from './shared';

/**
 * The features the backend's plans name, worded here until it sends plan copy per language
 * (FR-110; design PD-212). A key not listed is shown as it came, marked English.
 */
const KNOWN_FEATURES = [
  'seating',
  'check-in',
  'operations',
  'vendor-briefs',
  'thank-yous',
  'custom-design',
  'coordinator',
] as const;

type KnownFeature = (typeof KNOWN_FEATURES)[number];

function isKnownFeature(feature: string): feature is KnownFeature {
  return (KNOWN_FEATURES as readonly string[]).includes(feature);
}

function Feature({ feature }: { feature: string }) {
  const { t } = useTranslation('billing');
  return isKnownFeature(feature) ? (
    <li>{t(`features.${feature}`)}</li>
  ) : (
    <li lang="en">{feature}</li>
  );
}

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
        <Feature key={feature} feature={feature} />
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
  /** While payments are off, a paid plan is shown with its price but not offered (C-47). */
  isPaymentAvailable: boolean;
  onChoose: (plan: Plan, opener: MouseEvent<HTMLElement>) => void;
}

/** "After the free pilot": a paid plan nobody can buy while payments are off (design C-47). */
export function AfterPilot() {
  const { t } = useTranslation('billing');
  return <p className="m-0 mt-auto font-medium">{t('plans.afterPilot')}</p>;
}

/**
 * The price list (design PD-126): offered to a role with `billing:write` (FR-6, PD-190), but for the
 * one running now, as choosing it would start a new period, and a free one already scheduled for the
 * period's end (FR-135).
 */
export function PlanList({ plans, current, now, isPaymentAvailable, onChoose }: PlanListProps) {
  const { t } = useTranslation('billing');
  const canChoose = useCan('billing:write');
  return (
    <section aria-labelledby="billing-plans" className="flex flex-col gap-3">
      <h2 id="billing-plans" className="m-0 text-lg font-medium">
        {t('plans.title')}
      </h2>
      <PlanCards
        plans={plans}
        action={(plan) => {
          const offer = offerFor(plan, current, now);
          if (offer !== 'choose') {
            return <p className="m-0 mt-auto font-medium">{t(`plans.${offer}`)}</p>;
          }
          if (!isPaymentAvailable && !isFree(plan.priceMinor)) return <AfterPilot />;
          return canChoose ? (
            <Button
              variant="outline"
              className={`${WRAPPING_BUTTON} mt-auto self-start`}
              onClick={(opener) => onChoose(plan, opener)}
            >
              {t('plans.choose')}
            </Button>
          ) : null;
        }}
      />
    </section>
  );
}
