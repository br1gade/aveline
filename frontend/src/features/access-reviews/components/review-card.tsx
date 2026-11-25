import { useTranslation } from 'react-i18next';

import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { KNOWN_REASONS } from '../read';
import type { AccessReview, ReviewDecision } from '../types';
import { useReviewDay } from './shared';

const DECISIONS: readonly ReviewDecision[] = ['HANDOVER', 'CLOSE', 'DECLINE'];
const KNOWN: ReadonlySet<string> = new Set(KNOWN_REASONS);

function Reason({ reason }: { reason: string }) {
  const { t } = useTranslation('access-reviews');
  if (!KNOWN.has(reason))
    return (
      <p className="m-0 text-sm" lang="en">
        {reason}
      </p>
    );
  return <p className="m-0 text-sm">{t(`reason.${reason as (typeof KNOWN_REASONS)[number]}`)}</p>;
}

interface ReviewCardProps {
  review: AccessReview;
  onDecide: (review: AccessReview, decision: ReviewDecision, opener: HTMLElement) => void;
}

/** One review: which organization, why it was opened and when, and the three ways to resolve it. */
export function ReviewCard({ review, onDecide }: ReviewCardProps) {
  const { t } = useTranslation('access-reviews');
  const day = useReviewDay();
  const { name } = review.organization;
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <span className="font-medium break-words">{name}</span>
      <Reason reason={review.reason} />
      <p className="m-0 text-sm">{t('opened', { day: day(review.openedAt) })}</p>
      <div className="flex flex-wrap gap-2">
        {DECISIONS.map((decision) => (
          <Button
            key={decision}
            variant={decision === 'CLOSE' ? 'destructive' : 'outline'}
            className={WRAPPING_BUTTON}
            aria-label={t('decisionFor', { decision: t(`decision.${decision}`), name })}
            onClick={(click) => onDecide(review, decision, click.currentTarget)}
          >
            {t(`decision.${decision}`)}
          </Button>
        ))}
      </div>
    </li>
  );
}
