import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WordedRefusal, WRAPPING_BUTTON } from '@/ui/app-form';

import type { FollowUpRefusal } from '../refusals';

export const WRAPPING = `${WRAPPING_BUTTON} self-start text-left`;

export const LINK =
  'text-primary inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4 hover:no-underline';

/** A disclosure's summary, at least 44 px tall (frontend/CLAUDE.md §5). */
export const SUMMARY = 'cursor-pointer py-3';

/** A panel of the page: its heading, then what it holds. */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex max-w-[40rem] flex-col gap-3">
      <h2 id={titleId} className="m-0 text-lg font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** What a press did. The heading takes the focus when a result arrives. */
export function OutcomeFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation('follow-ups');
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col gap-4 border px-5 py-4"
    >
      <h3
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="m-0 text-base font-medium outline-none"
      >
        {t('outcome.title')}
      </h3>
      {children}
    </section>
  );
}

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function RefusalNotice({ refusal }: { refusal: FollowUpRefusal }) {
  const { t } = useTranslation('follow-ups');
  return (
    <WordedRefusal
      message={t(`refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}
