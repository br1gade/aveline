import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { browserSession } from '@/api/session';
import { LoadedProblem } from '@/features/sending';
import { APP_PATHS } from '@/route-paths';
import { StatusLine, useDialogOpener, usePageStatus, WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { listReviews } from '../api';
import type { AccessReviewsData } from '../load';
import { reviewRefusalOf, type ReviewRefusal } from '../refusals';
import type { AccessReview, ReviewDecision, ReviewsPage } from '../types';
import { DecisionDialog } from './review-dialogs';
import { ReviewCard } from './review-card';
import { ReviewProblem, type Who } from './shared';

const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

interface Asked {
  review: AccessReview;
  who: Who;
  decision: ReviewDecision;
}

/** Pages read past the first. A reload after a decision starts again from the first page. */
function useMore(first: ReviewsPage) {
  const [more, setMore] = useState<{ after: ReviewsPage; pages: ReviewsPage[] } | null>(null);
  const [refusal, setRefusal] = useState<ReviewRefusal | null>(null);
  const [isReading, setIsReading] = useState(false);
  const pages = more?.after === first ? more.pages : [];
  const last = pages.at(-1) ?? first;
  const readMore = async () => {
    if (!last.nextCursor) return;
    setRefusal(null);
    setIsReading(true);
    try {
      const next = await listReviews(browserSession().api, last.nextCursor);
      setMore({ after: first, pages: [...pages, next] });
    } catch (error) {
      setRefusal(reviewRefusalOf(error));
    } finally {
      setIsReading(false);
    }
  };
  const items = [first, ...pages].flatMap((page) => page.items);
  return { items, hasMore: last.nextCursor !== null, isReading, refusal, readMore };
}

function ReviewList({ first, onDecide }: { first: ReviewsPage; onDecide: OnDecide }) {
  const { t } = useTranslation('access-reviews');
  const { items, hasMore, isReading, refusal, readMore } = useMore(first);
  return (
    <>
      {items.length === 0 ? <p className="m-0">{t('none')}</p> : null}
      <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
        {items.map((review) => (
          <ReviewCard key={review.id} review={review} onDecide={onDecide} />
        ))}
      </ul>
      {refusal ? <ReviewProblem refusal={refusal} /> : null}
      {hasMore ? (
        <Button
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          disabled={isReading}
          onClick={() => void readMore()}
        >
          {isReading ? t('reading') : t('more')}
        </Button>
      ) : null}
    </>
  );
}

type OnDecide = (
  review: AccessReview,
  who: Who,
  decision: ReviewDecision,
  opener: HTMLElement,
) => void;

/**
 * Organizations' access reviews, oldest first (docs/API.md §6; design PD-175). Administrators only,
 * and told so otherwise. Nothing tells the owner the outcome (PQ-27), and the page says so.
 */
export function AccessReviewsPage({ data }: { data: AccessReviewsData }) {
  const { t } = useTranslation('access-reviews');
  const { page, status, statusRef } = usePageStatus(data);
  const { remember, restoreFocus } = useDialogOpener();
  const [asked, setAsked] = useState<Asked | null>(null);
  const onDecide: OnDecide = (review, who, decision, opener) => {
    remember(opener);
    setAsked({ review, who, decision });
  };
  const { reviews } = data;
  return (
    <section className="flex flex-col gap-5">
      <Link to={APP_PATHS.staff} className={LINK}>
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {reviews.kind === 'ready' ? (
        <ReviewList first={reviews.value} onDecide={onDecide} />
      ) : (
        <LoadedProblem loaded={reviews} refusedText={t('refusal.forbidden')} />
      )}
      {asked ? (
        <DecisionDialog
          review={asked.review}
          who={asked.who}
          decision={asked.decision}
          page={page}
          onClose={() => setAsked(null)}
          restoreFocus={restoreFocus}
        />
      ) : null}
    </section>
  );
}
