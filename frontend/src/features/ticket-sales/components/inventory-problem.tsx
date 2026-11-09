import { useTranslation } from 'react-i18next';

import { WordedRefusal } from '@/ui/app-form';

import type { InventoryAction, InventoryRefusal } from '../inventory-refusals';

/** A refusal in words, with whose action a 403 is: layouts are directory editors', inventory the event's writers'. */
export function InventoryProblem({
  refusal,
  action,
}: {
  refusal: InventoryRefusal | null;
  action: InventoryAction;
}) {
  const { t } = useTranslation('ticket-sales');
  if (!refusal) return null;
  const message =
    refusal.kind === 'forbidden'
      ? t(`inventory.refused.forbidden.${action}`)
      : t(`inventory.refused.${refusal.kind}`);
  return (
    <WordedRefusal
      message={message}
      english={'sentence' in refusal ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}
