import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { getCurrentOrganization } from '@/features/organization';
import { DEFAULT_TIME_ZONE, formatEventDay } from '@/lib/time';
import { WordedRefusal } from '@/ui/app-form';

import type { ReviewRefusal } from '../refusals';

export function ReviewProblem({ refusal }: { refusal: ReviewRefusal }) {
  const { t } = useTranslation('access-reviews');
  return (
    <WordedRefusal
      message={t(`refusal.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

/** No event names a zone here, so dates are Yerevan's, and the page says so. */
export function useReviewDay() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    formatEventDay(iso, { timeZone: DEFAULT_TIME_ZONE, locale: i18n.language });
}

export type OrganizationName =
  { kind: 'reading' } | { kind: 'read'; name: string } | { kind: 'unread' };

/** How a card names its organization: by name once read, by its reference until then or if it can't be. */
export interface Who {
  text: string;
  isNamed: boolean;
}

export function whoOf(name: OrganizationName, organizationId: string): Who {
  return name.kind === 'read'
    ? { text: name.name, isNamed: true }
    : { text: organizationId, isNamed: false };
}

/**
 * The organization's name, which a review doesn't carry (FR-133): read by naming the organization, as
 * only staff may. Until it comes, or if it can't be read, the card shows the organization's reference.
 */
export function useOrganizationName(organizationId: string): OrganizationName {
  const [name, setName] = useState<OrganizationName>({ kind: 'reading' });
  useEffect(() => {
    let isCurrent = true;
    getCurrentOrganization(browserSession().api, organizationId).then(
      (organization) => {
        if (isCurrent) setName({ kind: 'read', name: organization.name });
      },
      () => {
        if (isCurrent) setName({ kind: 'unread' });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [organizationId]);
  return name;
}
