import { useTranslation } from 'react-i18next';

import { useDialogAction, WordedRefusal, type DialogContext } from '@/ui/app-form';

import { refusalOf, type EntryRefusal } from '../refusals';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function EntryProblem({ refusal }: { refusal: EntryRefusal }) {
  const { t } = useTranslation('running-order');
  return (
    <WordedRefusal
      message={t(`refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

export function useEntryAction(context: DialogContext) {
  return useDialogAction<EntryRefusal>(context, refusalOf);
}

/** The names of the venues a change would take away from guests, or nothing. */
export function HiddenVenues({ names }: { names: readonly string[] }) {
  const { t } = useTranslation('running-order');
  if (names.length === 0) return null;
  return (
    <p className="border-border m-0 border-l-2 pl-3 text-sm">
      {t('hides', { count: names.length, venues: names.join(', ') })}
    </p>
  );
}
