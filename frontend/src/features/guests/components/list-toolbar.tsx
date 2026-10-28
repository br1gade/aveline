import { useTranslation } from 'react-i18next';

import { DELIVERY_GROUPS, type DeliveryGroup } from '@/features/sending';
import { SelectField, TextInputField } from '@/ui/app-form';
import { cn } from '@/ui/cn';
import { NativeSelectOption } from '@/ui/kit/native-select';

import type { GuestFilter } from '../filter';
import { ANSWERS, type Answer } from '../types';

interface ListToolbarProps {
  filter: GuestFilter;
  onQuery: (query: string) => void;
  onAnswer: (answer: Answer | null) => void;
  /** Offered only while there is a delivery report to filter by (design PD-48). */
  onInvite: ((invite: DeliveryGroup | null) => void) | null;
}

function answerOf(value: string): Answer | null {
  return ANSWERS.find((answer) => answer === value) ?? null;
}

function inviteOf(value: string): DeliveryGroup | null {
  return DELIVERY_GROUPS.find((group) => group === value) ?? null;
}

/**
 * The search, the answer filter and the invitation filter (design PD-44, PD-48). Not a form:
 * nothing here is submitted, so Enter sends nothing anywhere. The list keeps it in view.
 */
export function ListToolbar({ filter, onQuery, onAnswer, onInvite }: ListToolbarProps) {
  const { t } = useTranslation('guests');
  return (
    <div
      role="search"
      aria-label={t('toolbar.label')}
      className={cn(
        'grid gap-3',
        onInvite ? 'sm:grid-cols-[1fr_12rem_12rem]' : 'sm:grid-cols-[1fr_14rem]',
      )}
    >
      <TextInputField
        label={t('toolbar.search')}
        type="search"
        autoComplete="off"
        value={filter.query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <SelectField
        label={t('toolbar.answer')}
        value={filter.answer ?? ''}
        onChange={(event) => onAnswer(answerOf(event.target.value))}
      >
        <NativeSelectOption value="">{t('toolbar.anyAnswer')}</NativeSelectOption>
        {ANSWERS.map((answer) => (
          <NativeSelectOption key={answer} value={answer}>
            {t(`answer.${answer}`)}
          </NativeSelectOption>
        ))}
      </SelectField>
      {onInvite ? (
        <SelectField
          label={t('toolbar.invite')}
          value={filter.invite ?? ''}
          onChange={(event) => onInvite(inviteOf(event.target.value))}
        >
          <NativeSelectOption value="">{t('toolbar.anyInvite')}</NativeSelectOption>
          {DELIVERY_GROUPS.map((group) => (
            <NativeSelectOption key={group} value={group}>
              {t(`inviteGroup.${group}`)}
            </NativeSelectOption>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}
