import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import type { Plan } from '../plans';
import type { SeatingTable } from '../types';

/** A plan's name: its venue's, marked when guests don't see it, or "Without a venue". */
export function usePlanName(): (plan: Plan) => string {
  const { t } = useTranslation('seating');
  return ({ arrangement, kind }) => {
    const name = arrangement.venueName ?? t('planNoVenue');
    if (kind === 'unspecified') return t('planNoVenue');
    return kind === 'hidden' ? t('hiddenVenue', { name }) : name;
  };
}

/** The address for a plan, keeping the rest of the query. */
function useHrefFor(): (plan: Plan) => string {
  const [params] = useSearchParams();
  return (plan) => {
    const next = new URLSearchParams(params);
    next.set('plan', plan.arrangement.id);
    return `?${next.toString()}`;
  };
}

interface PlanTabsProps {
  plans: readonly Plan[];
  current: Plan;
  tables: readonly SeatingTable[];
}

/**
 * One tab per plan, kept in the address (`?plan=`) and written in place (design PD-67). Every
 * plan's tables are already loaded, so a tab reads nothing again.
 */
export function PlanTabs({ plans, current, tables }: PlanTabsProps) {
  const { t } = useTranslation('seating');
  const nameOf = usePlanName();
  const hrefFor = useHrefFor();
  if (plans.length < 2) return null;
  const seatedIn = (plan: Plan) =>
    tables
      .filter((table) => table.arrangementId === plan.arrangement.id)
      .reduce((sum, table) => sum + table.guests.length, 0);
  return (
    <nav aria-label={t('plans')}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {plans.map((plan) => (
          <li key={plan.arrangement.id}>
            <Link
              to={hrefFor(plan)}
              replace
              preventScrollReset
              aria-current={plan === current ? 'page' : undefined}
              className="border-border aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground inline-flex min-h-11 items-center border px-4 py-2 no-underline"
            >
              {t('planTab', { name: nameOf(plan), count: seatedIn(plan) })}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
