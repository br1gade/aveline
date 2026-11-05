import { useTranslation } from 'react-i18next';
import { generatePath, Link, Navigate, useLocation } from 'react-router';

import { CreateEvent } from '@/features/events';
import { APP_PATHS } from '@/route-paths';

import { createEventFor } from '../api';

export const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

/** The way to an event for a customer, carrying the name no address can be trusted to say. */
export function SetUpEventLink({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation('customers');
  return (
    <Link
      to={generatePath(APP_PATHS.staffNewEvent, { organizationId: id })}
      state={{ customerName: name }}
      className={LINK}
      aria-label={t('list.setUpFor', { name })}
    >
      {t('list.setUp')}
    </Link>
  );
}

function customerNameOf(state: unknown): string | null {
  const name = (state as { customerName?: unknown } | null)?.customerName;
  return typeof name === 'string' ? name : null;
}

/**
 * The owner's own event form, sending to the customer's organization (design PD-166). It names whose
 * it is. An address alone can't say, and one sent by someone else could point at another customer, so
 * without the name it goes back to choosing.
 */
export function CustomerNewEvent({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation('customers');
  const name = customerNameOf(useLocation().state);
  if (!name) return <Navigate to={APP_PATHS.staffCustomers} replace />;
  return (
    <CreateEvent
      lead={t('newEvent.lead', { name })}
      create={(api, body) => createEventFor(api, organizationId, body)}
    />
  );
}
