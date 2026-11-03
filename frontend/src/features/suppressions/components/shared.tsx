import { useTranslation } from 'react-i18next';

import { WordedRefusal } from '@/ui/app-form';

import type { SuppressionRefusal } from '../rules';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function SuppressionProblem({ refusal }: { refusal: SuppressionRefusal }) {
  const { t } = useTranslation('suppressions');
  return (
    <WordedRefusal
      message={t(`refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}
