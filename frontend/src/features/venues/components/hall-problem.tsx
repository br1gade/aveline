import { useTranslation } from 'react-i18next';

import { WordedRefusal } from '@/ui/app-form';

import type { HallRefusal } from '../directory';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function HallProblem({ refusal }: { refusal: HallRefusal }) {
  const { t } = useTranslation('venues');
  return (
    <WordedRefusal
      message={t(`directory.refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}
