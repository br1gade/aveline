import type { TFunction } from 'i18next';

import { StatusChip } from '@/ui';

import type { Answer } from '../types';

/**
 * A guest's answer, in the guest page's own chip: words first, the mark only to help scanning
 * (design PD-44). "Not answered" carries no mark, as nothing has been said.
 */
export function AnswerChip({ answer, t }: { answer: Answer; t: TFunction<'guests'> }) {
  if (answer === 'PENDING') {
    return (
      <span className="text-muted-foreground text-[12px] leading-4 font-medium tracking-[0.12em] uppercase">
        {t('answer.PENDING')}
      </span>
    );
  }
  return <StatusChip status={answer}>{t(`answer.${answer}`)}</StatusChip>;
}
